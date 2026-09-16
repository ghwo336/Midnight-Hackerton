import { describe, expect, it } from 'vitest';
import {
  ATTACKER_SECRET, LENDER_A_KEY, SUPPLIER_ADDRESS, buildScenario, invoiceAt,
} from '../fixtures/scenario.js';
import { ASSERT, expectCircuitReject } from '../fixtures/assert-reject.js';

/**
 * A4 — 다른 소유자의 채권으로 신청한다.
 * 기대: 소유권 검증 실패.
 *
 * 리프에 ownerPk가 들어 있으므로, 다른 비밀키로는 트리에 있는 리프를
 * 만들 수 없다.
 */
describe('A4 — 타인 채권으로 신청', () => {
  it('소유자가 아니면 거부된다', async () => {
    const sim = await buildScenario();
    const invoice = invoiceAt(0);

    await expectCircuitReject(
      () => sim.finance(
        {
          lender: 'lender-a', amount: 80_000_000n, recipient: SUPPLIER_ADDRESS,
          witness: { ...invoice, ownerSecret: ATTACKER_SECRET },
        },
        LENDER_A_KEY,
      ),
      ASSERT.LEAF_MISMATCH,
    );

    expect(sim.snapshot().nullifierCount).toBe(0);
    expect(sim.snapshot().lenderVault.get(LENDER_A_KEY)).toBe(1_000_000_000n);
  });
});
