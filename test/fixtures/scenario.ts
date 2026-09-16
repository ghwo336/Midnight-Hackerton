import type { Hex } from '@once/domain';
import { computeInvoiceLeaf, deriveIssuerPublicKey, deriveOwnerPublicKey } from '@once/crypto';
import { OnceContractSimulator } from '@once/chain';

/**
 * 데모 최소 구성: 발급 기관 1곳, 납품업체 1곳, 금융사 2곳, 채권 3건 (CONTEXT §8).
 */
export const ISSUER_ID = `0x${'11'.repeat(32)}` as Hex;
export const ISSUER_SECRET = `0x${'5e'.repeat(32)}` as Hex;
export const SUPPLIER_SECRET = `0x${'7c'.repeat(32)}` as Hex;
export const ATTACKER_SECRET = `0x${'ff'.repeat(32)}` as Hex;
export const SUPPLIER_ADDRESS = `0x${'cc'.repeat(32)}` as Hex;

export const LENDER_A_KEY = `0x${'0a'.repeat(32)}` as Hex;
export const LENDER_B_KEY = `0x${'0b'.repeat(32)}` as Hex;
export const UNREGISTERED_LENDER_KEY = `0x${'0c'.repeat(32)}` as Hex;

export const LTV_BPS = 8000n;
export const LENDER_FUNDING = 1_000_000_000n;

export interface SeedInvoice {
  readonly invoiceId: Hex;
  readonly faceAmount: bigint;
  readonly salt: Hex;
  readonly ownerSecret: Hex;
}

export const INVOICES: readonly SeedInvoice[] = [
  {
    invoiceId: `0x${'a1'.repeat(32)}` as Hex,
    faceAmount: 100_000_000n,
    salt: `0x${'d1'.repeat(32)}` as Hex,
    ownerSecret: SUPPLIER_SECRET,
  },
  {
    invoiceId: `0x${'a2'.repeat(32)}` as Hex,
    faceAmount: 50_000_000n,
    salt: `0x${'d2'.repeat(32)}` as Hex,
    ownerSecret: SUPPLIER_SECRET,
  },
  {
    invoiceId: `0x${'a3'.repeat(32)}` as Hex,
    faceAmount: 250_000_000n,
    salt: `0x${'d3'.repeat(32)}` as Hex,
    ownerSecret: SUPPLIER_SECRET,
  },
];

export async function buildScenario(): Promise<OnceContractSimulator> {
  const sim = await OnceContractSimulator.create({
    issuerId: ISSUER_ID,
    issuerSecret: ISSUER_SECRET,
    issuerPk: deriveIssuerPublicKey(ISSUER_SECRET),
    ltvBps: LTV_BPS,
  });

  await sim.registerLender(LENDER_A_KEY);
  await sim.registerLender(LENDER_B_KEY);
  await sim.fundLender(LENDER_A_KEY, LENDER_FUNDING);
  await sim.fundLender(LENDER_B_KEY, LENDER_FUNDING);

  for (const invoice of INVOICES) {
    const ownerPk = deriveOwnerPublicKey(invoice.ownerSecret);
    await sim.registerInvoice(
      computeInvoiceLeaf({
        invoiceId: invoice.invoiceId,
        faceAmount: invoice.faceAmount,
        ownerPk,
      }),
    );
  }

  return sim;
}

export function invoiceAt(index: number): SeedInvoice {
  const invoice = INVOICES[index];
  if (!invoice) throw new Error('invalid fixture index');
  return invoice;
}
