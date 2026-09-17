import { describe, expect, it } from 'vitest';
import type { Hex } from '@once/domain';
import { computeInvoiceLeaf, deriveIssuerPublicKey, deriveOwnerPublicKey } from '@once/crypto';
import { OnceContractSimulator } from '@once/chain';

const ISSUER_ID = `0x${'11'.repeat(32)}` as Hex;
const ISSUER_SECRET = `0x${'5e'.repeat(32)}` as Hex;
const OWNER_SECRET = `0x${'7c'.repeat(32)}` as Hex;
const LENDER_A = `0x${'0a'.repeat(32)}` as Hex;
const SUPPLIER_ADDR = `0x${'cc'.repeat(32)}` as Hex;
const INVOICE_ID = `0x${'a3'.repeat(32)}` as Hex;
const SALT = `0x${'d9'.repeat(32)}` as Hex;
const FACE = 100_000_000n;

describe('회로 스모크: 발급 → 등록 → 자금 → 지급', () => {
  it('정상 경로가 통과하고 원장에 기록이 남는다', async () => {
    const sim = await OnceContractSimulator.create({
      issuerId: ISSUER_ID,
      issuerSecret: ISSUER_SECRET,
      issuerPk: deriveIssuerPublicKey(ISSUER_SECRET),
      ltvBps: 8000n,
    });

    await sim.registerLender(LENDER_A);
    await sim.fundLender(LENDER_A, 500_000_000n);

    const ownerPk = deriveOwnerPublicKey(OWNER_SECRET);
    const leaf = computeInvoiceLeaf({ invoiceId: INVOICE_ID, faceAmount: FACE, ownerPk });
    await sim.registerInvoice(leaf);

    const result = await sim.finance(
      {
        lender: 'lender-a',
        amount: 80_000_000n,
        recipient: SUPPLIER_ADDR,
        witness: { invoiceId: INVOICE_ID, faceAmount: FACE, salt: SALT, ownerSecret: OWNER_SECRET },
      },
      LENDER_A,
    );

    expect(result.nullifier).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sim.isNullifierUsed(result.nullifier)).toBe(true);

    const snap = sim.snapshot();
    expect(snap.nullifierCount).toBe(1);
    expect(snap.loans).toHaveLength(1);
    expect(snap.loans[0]?.amount).toBe(80_000_000n);
    // 금융사 잔액이 실제로 줄었다. 자금이 나갔다는 증거
    expect(snap.lenderVault.get(LENDER_A)).toBe(420_000_000n);
  });
});
