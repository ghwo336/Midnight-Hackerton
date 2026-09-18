import { describe, expect, it } from 'vitest';
import { judgeConcurrent } from '../../apps/web/src/shared/runtime/concurrent-verdict.js';

/**
 * A5 판정이 **결과에서 나오는지** 고정한다.
 *
 * 한때 화면이 요청을 보낸 뒤 결과를 보지 않고 "통과" 를 써 넣었다.
 * 로컬에서는 우연히 맞았지만 두 요청이 다른 이유로 죽어도 초록불이 떴다.
 * 이 스위트가 없으면 같은 실수가 조용히 돌아온다.
 */
const AMOUNT = '80000000';

describe('A5 판정', () => {
  it('한 건만 확정되면 통과다', () => {
    const v = judgeConcurrent({
      settledCount: 1, rejectedCount: 1,
      rejectionCode: 'NULLIFIER_ALREADY_USED', amountPerLoan: AMOUNT,
    });
    expect(v.blocked).toBe(true);
    expect(v.code).toBe('NULLIFIER_ALREADY_USED');
    expect(v.fundsMoved).toBe(AMOUNT);
  });

  it('두 건 모두 확정되면 실패다 — 이중 담보가 뚫린 것이다', () => {
    const v = judgeConcurrent({
      settledCount: 2, rejectedCount: 0, rejectionCode: null, amountPerLoan: AMOUNT,
    });
    expect(v.blocked).toBe(false);
    expect(v.fundsMoved).toBe('160000000');
    expect(v.note).toContain('이중 담보');
  });

  /*
   * 여기가 핵심이다. 서버가 서명하지 못해 둘 다 죽는 경우가 실제로 있다
   * (실제 체인 모드). 그때 통과로 세면 아무것도 시험하지 않고 초록불을
   * 켜는 것이다.
   */
  it('두 건 모두 실패하면 통과가 아니다', () => {
    const v = judgeConcurrent({
      settledCount: 0, rejectedCount: 2,
      rejectionCode: 'SERVER_CANNOT_SIGN', amountPerLoan: AMOUNT,
    });
    expect(v.blocked).toBe(false);
    expect(v.code).toBe('SERVER_CANNOT_SIGN');
    expect(v.fundsMoved).toBe('0');
    expect(v.note).toContain('회로가 막은 것이 아니다');
  });

  it('나간 자금은 확정 건수에 비례한다', () => {
    for (const [count, expected] of [[0, '0'], [1, AMOUNT], [2, '160000000']] as const) {
      expect(
        judgeConcurrent({
          settledCount: count, rejectedCount: 2 - count,
          rejectionCode: null, amountPerLoan: AMOUNT,
        }).fundsMoved,
      ).toBe(expected);
    }
  });
});
