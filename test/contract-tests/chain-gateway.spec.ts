import { describe, expect, it } from 'vitest';
import { deriveIssuerPublicKey, computeInvoiceLeaf, deriveOwnerPublicKey } from '@once/crypto';
import { OnceContractSimulator } from '@once/chain';
import { NullifierAlreadyUsedError, LenderNotRegisteredError, type Hex } from '@once/domain';
import type { ChainReader, ChainWriter } from '../../apps/api/src/application/ports/chain.gateway.js';
import { LocalCircuitChainGateway } from '../../apps/api/src/infrastructure/chain/local-circuit.gateway.js';
import { fixedSource } from '../../apps/api/src/infrastructure/chain/simulator.source.js';
import { LENDER_FUNDING, LENDER_KEYS } from '../../apps/api/src/config/demo.config.js';

/**
 * LSP — 공유 계약 테스트 (SPEC §5).
 *
 * ChainGateway의 모든 구현이 같은 계약을 지켜야 한다. 특히 중복 nullifier에
 * 대해 어떤 구현이든 NullifierAlreadyUsedError를 던져야 한다. 구현마다 다른
 * 오류를 던지면 테스트가 거짓말을 한다.
 *
 * 나중에 MidnightChainGateway를 추가하면 이 스위트를 그대로 돌린다.
 * 새 구현이 통과하지 못하면 유스케이스를 고치는 게 아니라 구현을 고친다.
 */
const ISSUER_ID = `0x${'11'.repeat(32)}` as Hex;
const ISSUER_SECRET = `0x${'5e'.repeat(32)}` as Hex;
const OWNER_SECRET = `0x${'7c'.repeat(32)}` as Hex;
const RECIPIENT = `0x${'cc'.repeat(32)}` as Hex;
const INVOICE_ID = `0x${'a1'.repeat(32)}` as Hex;
const FACE = 100_000_000n;

type Gateway = ChainReader & ChainWriter;

export function chainGatewayContract(name: string, create: () => Promise<Gateway>): void {
  describe(`ChainGateway 계약: ${name}`, () => {
    it('발급 기관 식별자와 LTV를 읽는다', async () => {
      const gateway = await create();
      expect(await gateway.getIssuerId()).toBe(ISSUER_ID);
      expect(await gateway.getLtvBps()).toBe(8000n);
    });

    it('미사용 nullifier는 false를 돌려준다', async () => {
      const gateway = await create();
      expect(await gateway.isNullifierUsed(`0x${'00'.repeat(32)}` as Hex)).toBe(false);
    });

    it('정상 대출이 확정되고 잔액이 줄어든다', async () => {
      const gateway = await create();
      const before = await gateway.getLenderVault('lender-a');
      const result = await gateway.submitFinancing({
        lender: 'lender-a', amount: 80_000_000n, recipient: RECIPIENT,
        witness: {
          invoiceId: INVOICE_ID, faceAmount: FACE,
          salt: `0x${'d1'.repeat(32)}` as Hex, ownerSecret: OWNER_SECRET,
        },
      });
      expect(await gateway.isNullifierUsed(result.nullifier)).toBe(true);
      expect(await gateway.getLenderVault('lender-a')).toBe(before - 80_000_000n);
    });

    it('중복 nullifier에 NullifierAlreadyUsedError를 던진다', async () => {
      const gateway = await create();
      const tx = {
        lender: 'lender-a' as const, amount: 80_000_000n, recipient: RECIPIENT,
        witness: {
          invoiceId: INVOICE_ID, faceAmount: FACE,
          salt: `0x${'d1'.repeat(32)}` as Hex, ownerSecret: OWNER_SECRET,
        },
      };
      await gateway.submitFinancing(tx);
      await expect(
        gateway.submitFinancing({ ...tx, lender: 'lender-b' }),
      ).rejects.toBeInstanceOf(NullifierAlreadyUsedError);
    });

    it('공개 원장 행에 채권 원문 필드가 없다', async () => {
      const gateway = await create();
      await gateway.submitFinancing({
        lender: 'lender-a', amount: 80_000_000n, recipient: RECIPIENT,
        witness: {
          invoiceId: INVOICE_ID, faceAmount: FACE,
          salt: `0x${'d1'.repeat(32)}` as Hex, ownerSecret: OWNER_SECRET,
        },
      });
      const loans = await gateway.listLoans();
      expect(Object.keys(loans[0] ?? {}).sort()).toEqual(
        ['amount', 'block', 'commitment', 'lender', 'nullifier', 'txHash'],
      );
    });
  });
}

chainGatewayContract('LocalCircuitChainGateway', async () => {
  const sim = await OnceContractSimulator.create({
    issuerId: ISSUER_ID,
    issuerSecret: ISSUER_SECRET,
    issuerPk: deriveIssuerPublicKey(ISSUER_SECRET),
    ltvBps: 8000n,
  });
  for (const key of Object.values(LENDER_KEYS)) {
    await sim.registerLender(key);
    await sim.fundLender(key, LENDER_FUNDING);
  }
  await sim.registerInvoice(
    computeInvoiceLeaf({
      invoiceId: INVOICE_ID,
      faceAmount: FACE,
      ownerPk: deriveOwnerPublicKey(OWNER_SECRET),
    }),
  );
  return new LocalCircuitChainGateway(fixedSource(sim));
});

// 미등록 금융사 계약은 게이트웨이 단독으로 확인한다
describe('ChainGateway 계약: 미등록 금융사', () => {
  it('LenderNotRegisteredError를 던진다', async () => {
    const sim = await OnceContractSimulator.create({
      issuerId: ISSUER_ID,
      issuerSecret: ISSUER_SECRET,
      issuerPk: deriveIssuerPublicKey(ISSUER_SECRET),
      ltvBps: 8000n,
    });
    // lender-a만 등록하고 lender-b는 등록하지 않는다
    await sim.registerLender(LENDER_KEYS['lender-a']);
    await sim.fundLender(LENDER_KEYS['lender-a'], LENDER_FUNDING);
    await sim.registerInvoice(
      computeInvoiceLeaf({
        invoiceId: INVOICE_ID, faceAmount: FACE,
        ownerPk: deriveOwnerPublicKey(OWNER_SECRET),
      }),
    );
    const gateway = new LocalCircuitChainGateway(fixedSource(sim));

    await expect(
      gateway.submitFinancing({
        lender: 'lender-b', amount: 80_000_000n, recipient: RECIPIENT,
        witness: {
          invoiceId: INVOICE_ID, faceAmount: FACE,
          salt: `0x${'d1'.repeat(32)}` as Hex, ownerSecret: OWNER_SECRET,
        },
      }),
    ).rejects.toBeInstanceOf(LenderNotRegisteredError);
  });
});
