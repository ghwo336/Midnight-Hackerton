import { describe, expect, it } from 'vitest';
import {
  LENDER_A_KEY, LENDER_B_KEY, LENDER_FUNDING, SUPPLIER_ADDRESS, buildScenario, invoiceAt,
} from '../fixtures/scenario.js';

/**
 * A5 — 같은 채권으로 두 금융사에 동시 신청한다.
 * 기대: 하나만 확정되고, 다른 쪽 자금은 보존된다.
 *
 * 이것이 "조회 API로 단순화"가 불가능한 이유다 (CONTEXT §4.3).
 * 두 신청 모두 사전 조회에서는 "미사용"을 보게 된다. 방어는 실행 시점에만
 * 성립한다.
 */
describe('A5 — 두 금융사에 동시 신청', () => {
  it('정확히 하나만 성공하고 나머지 자금은 그대로다', async () => {
    const sim = await buildScenario();
    const invoice = invoiceAt(0);
    const amount = 80_000_000n;

    // 사전 조회 시점에는 둘 다 "미사용"으로 보인다
    expect(sim.snapshot().nullifierCount).toBe(0);

    const results = await Promise.allSettled([
      sim.finance(
        { lender: 'lender-a', amount, recipient: SUPPLIER_ADDRESS, witness: invoice },
        LENDER_A_KEY,
      ),
      sim.finance(
        { lender: 'lender-b', amount, recipient: SUPPLIER_ADDRESS, witness: invoice },
        LENDER_B_KEY,
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const snap = sim.snapshot();
    expect(snap.nullifierCount).toBe(1);
    expect(snap.loans).toHaveLength(1);

    // 총 지출은 정확히 한 건이다. 1억짜리 채권으로 1억 6천이 나가지 않는다.
    const spentA = LENDER_FUNDING - (snap.lenderVault.get(LENDER_A_KEY) ?? 0n);
    const spentB = LENDER_FUNDING - (snap.lenderVault.get(LENDER_B_KEY) ?? 0n);
    expect(spentA + spentB).toBe(amount);
    expect(spentA === 0n || spentB === 0n).toBe(true);
  });

  it('동시 신청을 5건 넣어도 하나만 통과한다', async () => {
    const sim = await buildScenario();
    const invoice = invoiceAt(1);
    const amount = 40_000_000n;

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        sim.finance(
          {
            lender: i % 2 === 0 ? 'lender-a' : 'lender-b',
            amount, recipient: SUPPLIER_ADDRESS, witness: invoice,
          },
          i % 2 === 0 ? LENDER_A_KEY : LENDER_B_KEY,
        ),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(sim.snapshot().nullifierCount).toBe(1);

    const snap = sim.snapshot();
    const spent =
      LENDER_FUNDING - (snap.lenderVault.get(LENDER_A_KEY) ?? 0n) +
      (LENDER_FUNDING - (snap.lenderVault.get(LENDER_B_KEY) ?? 0n));
    expect(spent).toBe(amount);
  });
});
