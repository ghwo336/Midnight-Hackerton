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
const settled = (lender: string, block = 100): AttemptResult => ({
  lender, settled: true, code: null, detail: null,
  txHash: `0x${'ab'.repeat(32)}`, block, ms: 40_000,
});

const rejected = (lender: string, code: string | null, detail: string | null = null): AttemptResult => ({
  lender, settled: false, code, detail, txHash: null, block: null, ms: 12_000,
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
