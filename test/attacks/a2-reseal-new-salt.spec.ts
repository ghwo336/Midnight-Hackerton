import { describe, expect, it } from 'vitest';
import { computeCommitment, computeNullifier, deriveOwnerPublicKey, generateSalt } from '@once/crypto';
import {
  ISSUER_ID, LENDER_A_KEY, LENDER_B_KEY, SUPPLIER_ADDRESS, buildScenario, invoiceAt,
} from '../fixtures/scenario.js';

/**
 * A2 — 새 salt로 다시 봉인해 다른 담보처럼 신청한다.
 * 기대: commitment은 다르지만 nullifier가 같아 거부.
 *
 * 이것이 nullifier에 salt를 섞으면 안 되는 이유다 (SPEC §13).
 */
describe('A2 — 새 salt로 재봉인 후 신청', () => {
  it('commitment은 달라지지만 nullifier가 같아 거부된다', async () => {
    const sim = await buildScenario();
    const invoice = invoiceAt(0);
    const ownerPk = deriveOwnerPublicKey(invoice.ownerSecret);

    const first = await sim.finance(
      { lender: 'lender-a', amount: 80_000_000n, recipient: SUPPLIER_ADDRESS, witness: invoice },
      LENDER_A_KEY,
    );

    const freshSalt = generateSalt();
    const resealed = { ...invoice, salt: freshSalt };

    // 봉인값은 실제로 달라진다
    expect(
      computeCommitment({
        invoiceId: invoice.invoiceId, faceAmount: invoice.faceAmount, ownerPk, salt: freshSalt,
      }),
    ).not.toBe(first.commitment);

    // 그런데 중복 확인값은 같다
    expect(computeNullifier(ISSUER_ID, invoice.invoiceId)).toBe(first.nullifier);

    await expect(
      sim.finance(
        { lender: 'lender-b', amount: 80_000_000n, recipient: SUPPLIER_ADDRESS, witness: resealed },
        LENDER_B_KEY,
      ),
    ).rejects.toThrow();

    expect(sim.snapshot().nullifierCount).toBe(1);
    expect(sim.snapshot().lenderVault.get(LENDER_B_KEY)).toBe(1_000_000_000n);
  });
});
