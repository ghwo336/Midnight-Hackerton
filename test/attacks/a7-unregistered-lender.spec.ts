import { describe, expect, it } from 'vitest';
import {
  SUPPLIER_ADDRESS, UNREGISTERED_LENDER_KEY, buildScenario, invoiceAt,
} from '../fixtures/scenario.js';
import { ASSERT, expectCircuitReject } from '../fixtures/assert-reject.js';

/**
 * A7 — 등록되지 않은 금융사로 신청한다.
 * 기대: 거부.
 */
describe('A7 — 미등록 금융사', () => {
  it('등록되지 않은 금융사는 대출을 실행할 수 없다', async () => {
    const sim = await buildScenario();
    const invoice = invoiceAt(0);

    expect(sim.snapshot().registeredLenders).not.toContain(UNREGISTERED_LENDER_KEY);

    await expectCircuitReject(
      () => sim.finance(
        { lender: 'lender-a', amount: 80_000_000n, recipient: SUPPLIER_ADDRESS, witness: invoice },
        UNREGISTERED_LENDER_KEY,
      ),
      ASSERT.LENDER_UNREGISTERED,
    );

    expect(sim.snapshot().nullifierCount).toBe(0);
  });
});
