import { describe, expect, it } from 'vitest';
import {
  judgeA5, judgeA6, type AttemptResult,
} from '../../apps/web/src/shared/runtime/onchain-verdict.js';

/**
 * 실제 체인 공격 판정을 고정한다.
 *
 * **시뮬레이터에 없던 실패 방식이 여기에는 있다.** 지갑이 잔액 조정에
 * 실패하거나 사용자가 승인 창을 닫으면 신청은 회로에 닿지도 못한다.
 * 그걸 "막혔다" 로 세면 아무것도 시험하지 않고 초록불을 켜는 것이다.
 * 이 스위트가 그 경로를 모두 고정한다.
 */
const settled = (lender: string, block = 100, startedAt = 0, endedAt = 1000): AttemptResult => ({
  lender, settled: true, code: null, detail: null,
  txHash: `0x${'ab'.repeat(32)}`, block, ms: 40_000, startedAt, endedAt,
});

const rejected = (
  lender: string, code: string | null, detail: string | null = null,
  startedAt = 0, endedAt = 1000,
): AttemptResult => ({
  lender, settled: false, code, detail, txHash: null, block: null, ms: 12_000,
  startedAt, endedAt,
});

describe('A5 · 실제 체인', () => {
  it('한 건 확정 + 회로가 중복으로 막음 → 통과', () => {
    const r = judgeA5([settled('lender-a'), rejected('lender-b', 'NULLIFIER_ALREADY_USED')]);
    expect(r.verdict).toBe('pass');
  });

  it('두 건 모두 확정 → 실패', () => {
    const r = judgeA5([settled('lender-a'), settled('lender-b')]);
    expect(r.verdict).toBe('fail');
    expect(r.note).toContain('두 번');
  });

  /*
   * 여기가 핵심이다. 지갑이 두 트랜잭션의 자금을 동시에 잡지 못해 한쪽이
   * 죽는 일이 실제로 있다. 회로가 막았다는 증거가 없으므로 통과가 아니다.
   */
  it('진 쪽이 회로 밖에서 죽으면 판정 불가', () => {
    const r = judgeA5([
      settled('lender-a'),
      rejected('lender-b', null, 'could not balance dust'),
    ]);
    expect(r.verdict).toBe('inconclusive');
    expect(r.note).toContain('could not balance dust');
  });

  it('확정이 하나도 없으면 판정 불가', () => {
    const r = judgeA5([
      rejected('lender-a', null, '사용자가 승인을 거부했다'),
      rejected('lender-b', null, '사용자가 승인을 거부했다'),
    ]);
    expect(r.verdict).toBe('inconclusive');
  });

  it('진 쪽이 다른 회로 사유로 막히면 판정 불가', () => {
    const r = judgeA5([settled('lender-a'), rejected('lender-b', 'INSUFFICIENT_LENDER_FUNDING')]);
    expect(r.verdict).toBe('inconclusive');
  });
});

describe('A6 · 실제 체인', () => {
  it('셋업 확정 + 지연 제출이 회로에서 막힘 → 통과', () => {
    const r = judgeA6(settled('lender-a'), rejected('lender-b', 'NULLIFIER_ALREADY_USED'));
    expect(r.verdict).toBe('pass');
  });

  it('지연 제출이 확정되면 실패', () => {
    const r = judgeA6(settled('lender-a'), settled('lender-b'));
    expect(r.verdict).toBe('fail');
    expect(r.note).toContain('실행 시점 재검사');
  });

  it('셋업이 확정되지 않으면 시험할 상태가 없다 → 판정 불가', () => {
    const r = judgeA6(rejected('lender-a', null, '승인 거부'), rejected('lender-b', null, '승인 거부'));
    expect(r.verdict).toBe('inconclusive');
    expect(r.note).toContain('셋업');
  });

  it('지연 제출이 회로 밖에서 죽으면 판정 불가', () => {
    const r = judgeA6(settled('lender-a'), rejected('lender-b', null, 'proof server timeout'));
    expect(r.verdict).toBe('inconclusive');
    expect(r.note).toContain('proof server timeout');
  });
});

/**
 * 겹치지 않은 "동시" 신청.
 *
 * 지갑은 한 지갑에서 나가는 트랜잭션을 직렬화한다 — UTXO 하나는 한 번만
 * 쓸 수 있어서 같은 지갑의 두 건이 같은 입력을 고르기 때문이고, 특정
 * 지갑의 문제가 아니라 UTXO 모델 자체의 성질이다.
 *
 * 그러면 앞 건이 확정된 **뒤에** 뒤 건이 나가고, 회로가 당연히 중복으로
 * 막는다. 예전 판정은 그걸 '통과' 로 셌다. 조건은 다 맞지만 합의 계층의
 * 경합은 시험하지 않았다 — A6 을 한 번 더 돌린 것에 가깝다.
 */
describe('A5 · 두 신청이 겹쳤는가', () => {
  it('순차로 나갔으면 통과로 세지 않는다', () => {
    const first = settled('lender-a', 100, 0, 40_000);
    const second = rejected('lender-b', 'NULLIFIER_ALREADY_USED', null, 45_000, 60_000);
    const r = judgeA5([first, second]);
    expect(r.verdict).toBe('inconclusive');
    expect(r.note).toContain('겹치지 않았다');
  });

  it('겹쳤으면 통과다', () => {
    const first = settled('lender-a', 100, 0, 40_000);
    const second = rejected('lender-b', 'NULLIFIER_ALREADY_USED', null, 1_000, 38_000);
    expect(judgeA5([first, second]).verdict).toBe('pass');
  });

  it('겹침 판정은 순서에 무관하다', () => {
    const a = settled('lender-a', 100, 5_000, 40_000);
    const b = rejected('lender-b', 'NULLIFIER_ALREADY_USED', null, 0, 10_000);
    expect(judgeA5([a, b]).verdict).toBe('pass');
    expect(judgeA5([b, a]).verdict).toBe('pass');
  });

  it('겹침 검사가 다른 판정을 덮지 않는다', () => {
    // 두 건 확정은 겹침과 무관하게 실패다.
    const r = judgeA5([settled('lender-a', 100, 0, 10), settled('lender-b', 101, 50, 60)]);
    expect(r.verdict).toBe('fail');
  });
});
