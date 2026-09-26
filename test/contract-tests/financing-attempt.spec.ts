import { describe, expect, it, vi } from 'vitest';
import {
  judgeStaleRejection, runFinancingAttempt,
  type AttemptDeps, type AttemptPlan,
} from '../../apps/web/src/shared/runtime/financing-attempt.js';
import { judgeA6 } from '../../apps/web/src/shared/runtime/onchain-verdict.js';

/**
 * 실제 체인 신청 한 건의 흐름.
 *
 * A6 가 **한 번도 체인에 제출되지 않던** 버그를 고정한다. 미리 준비한 신청을
 * 넘겨도 서버 사전 검사를 먼저 다시 불렀고, A6 는 다른 금융사가 확정된 뒤라
 * 사전 검사가 409 로 막았다. 준비해 둔 트랜잭션은 그대로 버려졌다.
 */
const PLAN: AttemptPlan = {
  applicationId: 'app-1', amount: '80000000',
  nullifier: `0x${'8d'.repeat(32)}`, receivedAt: '2026-09-26T00:00:00Z',
};

function deps(over: Partial<AttemptDeps<AttemptPlan>> = {}): AttemptDeps<AttemptPlan> {
  let t = 1_000;
  return {
    now: () => (t += 10),
    prepare: vi.fn(async () => PLAN),
    submit: vi.fn(async () => ({ txHash: '0xabc', block: 42 })),
    confirm: vi.fn(async () => undefined),
    classify: () => null,
    chainStatusOf: () => null,
    describe: (e) => (e instanceof Error ? e.message : String(e)),
    describePrepareError: (e) => (e instanceof Error ? e.message : String(e)),
    ...over,
  };
}

describe('미리 준비한 신청', () => {
  it('서버 사전 검사를 다시 부르지 않는다', async () => {
    const d = deps({
      // A6 의 실제 상황: 이미 확정된 뒤라 사전 검사는 막는다
      prepare: vi.fn(async () => { throw new Error('NULLIFIER_ALREADY_USED'); }),
    });
    const submit = vi.fn(async () => ({ txHash: '0xdef', block: 43 }));

    await runFinancingAttempt('lender-b', d, { plan: PLAN, submit });

    expect(d.prepare).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('준비해 둔 재료로 서버에 보고한다', async () => {
    const d = deps();
    await runFinancingAttempt('lender-b', d, {
      plan: PLAN,
      submit: async () => { throw new Error('boom'); },
    });
    expect(d.confirm).toHaveBeenCalledWith(PLAN, expect.objectContaining({ outcome: 'rejected' }));
  });
});

describe('일반 신청', () => {
  it('사전 검사에서 막히면 제출하지 않고 회로 사유를 비워 둔다', async () => {
    const d = deps({ prepare: vi.fn(async () => { throw new Error('LENDER_NOT_REGISTERED'); }) });
    const r = await runFinancingAttempt('lender-a', d);
    expect(d.submit).not.toHaveBeenCalled();
    expect(r.settled).toBe(false);
    expect(r.code).toBeNull();
    expect(r.detail).toBe('LENDER_NOT_REGISTERED');
  });

  it('성공하면 체인 결과를 남긴다', async () => {
    const r = await runFinancingAttempt('lender-a', deps());
    expect(r).toMatchObject({ settled: true, txHash: '0xabc', block: 42, confirmError: null });
  });
});

describe('서버 보고 실패', () => {
  /*
   * 예전에는 삼켰다. 그 사이 서버가 성공 보고를 전부 거절했는데(txHash 형식)
   * 금융사 화면이 왜 비었는지 아무도 알 수 없었다.
   */
  it('삼키지 않고 결과에 남긴다 — 판정은 바꾸지 않는다', async () => {
    const r = await runFinancingAttempt('lender-a', deps({
      confirm: async () => { throw new Error('400 txHash invalid'); },
    }));
    expect(r.settled).toBe(true);
    expect(r.confirmError).toBe('400 txHash invalid');
  });
});

describe('체인 실행 증거', () => {
  it('체인이 실패로 기록한 상태값을 남긴다', async () => {
    const r = await runFinancingAttempt('lender-b', deps({
      submit: async () => { throw new Error('tx failed'); },
      chainStatusOf: () => 'FailEntirely',
    }));
    expect(r.chainStatus).toBe('FailEntirely');
    expect(r.code).toBeNull();
  });
});

describe('A6 지연 제출의 체인 거부 판정', () => {
  const setup = 'lender-a';

  it('체인이 실행해 FailEntirely 로 기록했고 원장 대출이 셋업 금융사 1건이면 중복 확인값 거부다', () => {
    const j = judgeStaleRejection({
      chainStatus: 'FailEntirely', loansForNullifier: [{ lender: setup }], setupLender: setup,
    });
    expect(j.code).toBe('NULLIFIER_ALREADY_USED');
  });

  /*
   * finance 회로에는 checkpoint 가 없어 원장 연산이 전부 guaranteed 구간이다.
   * FailFallible 은 이 회로에서 나올 수 없는 값이라, 나왔다면 모르는 일이다.
   */
  it('FailFallible 은 이 회로에서 예상 밖이라 판정하지 않는다', () => {
    const j = judgeStaleRejection({
      chainStatus: 'FailFallible', loansForNullifier: [{ lender: setup }], setupLender: setup,
    });
    expect(j.code).toBeNull();
    expect(j.note).toContain('FailEntirely');
  });

  it('증거가 없을 때 멤풀 거부 가능성을 적는다', () => {
    const j = judgeStaleRejection({
      chainStatus: null, loansForNullifier: [{ lender: setup }], setupLender: setup,
    });
    expect(j.note).toContain('멤풀');
  });

  /*
   * 제출 단계 오류나 확정 대기 타임아웃은 체인이 실행했다는 증거가 아니다.
   * 지갑·대납 서버 문제로 죽은 것을 통과로 세면 아무것도 시험하지 않고
   * 초록불을 켠다.
   */
  it('체인이 실행했다는 증거가 없으면 판정하지 않는다', () => {
    const j = judgeStaleRejection({
      chainStatus: null, loansForNullifier: [{ lender: setup }], setupLender: setup,
    });
    expect(j.code).toBeNull();
  });

  it('원장에 대출이 두 건이면 판정하지 않는다 (이중 담보가 뚫렸을 수 있다)', () => {
    const j = judgeStaleRejection({
      chainStatus: 'FailEntirely',
      loansForNullifier: [{ lender: setup }, { lender: 'lender-b' }],
      setupLender: setup,
    });
    expect(j.code).toBeNull();
  });

  it('원장의 대출이 셋업 금융사 것이 아니면 판정하지 않는다', () => {
    const j = judgeStaleRejection({
      chainStatus: 'FailEntirely', loansForNullifier: [{ lender: 'lender-b' }], setupLender: setup,
    });
    expect(j.code).toBeNull();
  });

  it('판정기와 이어 붙이면 증거가 있을 때만 A6 가 통과한다', () => {
    const setupAttempt = {
      lender: setup, settled: true, code: null, detail: null,
      txHash: '0x1', block: 1, ms: 1, startedAt: 0, endedAt: 1,
    };
    const delayed = (code: string | null) => ({
      lender: 'lender-b', settled: false, code, detail: null,
      txHash: null, block: null, ms: 1, startedAt: 2, endedAt: 3,
    });
    const withEvidence = judgeStaleRejection({
      chainStatus: 'FailEntirely', loansForNullifier: [{ lender: setup }], setupLender: setup,
    });
    const without = judgeStaleRejection({
      chainStatus: null, loansForNullifier: [{ lender: setup }], setupLender: setup,
    });
    expect(judgeA6(setupAttempt, delayed(withEvidence.code)).verdict).toBe('pass');
    expect(judgeA6(setupAttempt, delayed(without.code)).verdict).toBe('inconclusive');
  });
});

/**
 * 셋업이 원장에 확정됐는가.
 *
 * 지갑이 "Wallet UI disconnected" 로 실패를 보고했는데 대출은 블록에 들어가
 * 있었던 적이 있다. 반대로 셋업이 정말 안 됐는데 지연 신청을 내면 체인이
 * 정상 대출로 받아 채권만 잃는다(연습용에서 실제로 잃었다).
 */
describe('셋업 확정 여부는 원장으로 본다', () => {
  const NF = `0x${'8d'.repeat(32)}`;

  it('원장에 셋업 금융사의 대출이 있으면 확정이다 — 지갑 오류와 무관하게', async () => {
    const { setupSettledOnLedger } = await import(
      '../../apps/web/src/shared/runtime/financing-attempt.js'
    );
    expect(setupSettledOnLedger({
      loans: [{ nullifier: NF.toUpperCase().replace('0X', '0x'), lender: 'lender-a' }],
      nullifier: NF, setupLender: 'lender-a',
    })).toBe(true);
  });

  it('없거나 다른 금융사의 것이면 확정이 아니다', async () => {
    const { setupSettledOnLedger } = await import(
      '../../apps/web/src/shared/runtime/financing-attempt.js'
    );
    expect(setupSettledOnLedger({ loans: [], nullifier: NF, setupLender: 'lender-a' })).toBe(false);
    expect(setupSettledOnLedger({
      loans: [{ nullifier: NF, lender: 'lender-b' }], nullifier: NF, setupLender: 'lender-a',
    })).toBe(false);
    expect(setupSettledOnLedger({
      loans: [{ nullifier: `0x${'ab'.repeat(32)}`, lender: 'lender-a' }],
      nullifier: NF, setupLender: 'lender-a',
    })).toBe(false);
  });
});
