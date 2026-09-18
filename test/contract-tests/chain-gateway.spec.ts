import { describe, expect, it } from 'vitest';
import { deriveIssuerPublicKey, computeInvoiceLeaf, deriveOwnerPublicKey } from '@once/crypto';
import { OnceContractSimulator } from '@once/chain';
import {
  NullifierAlreadyUsedError, LenderNotRegisteredError, PUBLIC_LOAN_FIELDS, type Hex,
} from '@once/domain';
import type { ChainReader, ChainWriter } from '../../apps/api/src/application/ports/chain.gateway.js';
import { LocalCircuitChainGateway } from '../../apps/api/src/infrastructure/chain/local-circuit.gateway.js';
import { fixedSource } from '../../apps/api/src/infrastructure/chain/simulator.source.js';
import { LENDER_FUNDING, LENDER_KEYS } from '../../apps/api/src/config/demo.config.js';

/**
 * LSP: 공유 계약 테스트 (SPEC §5).
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

/**
 * 읽기 계약. **모든 구현이 지킨다.**
 *
 * 로컬 시뮬레이터와 실제 체인(MidnightChainGateway)에 같은 스위트를
 * 돌린다. 두 구현이 같은 질문에 다르게 답하면 화면이 모드에 따라 다른
 * 것을 주장하게 된다. 실제 체인 쪽은 네트워크가 필요하므로 옵트인이다
 * (test/contract-tests/live-chain.spec.ts).
 */
export function chainReaderContract(name: string, create: () => Promise<ChainReader>): void {
  describe(`ChainReader 계약: ${name}`, () => {
    it('발급 기관 식별자와 LTV를 읽는다', async () => {
      const gateway = await create();
      expect(await gateway.getIssuerId()).toBe(ISSUER_ID);
      expect(await gateway.getLtvBps()).toBe(8000n);
    });

    it('미사용 nullifier는 false를 돌려준다', async () => {
      const gateway = await create();
      expect(await gateway.isNullifierUsed(`0x${'00'.repeat(32)}` as Hex)).toBe(false);
    });

    it('발급자가 인증한 채권의 리프를 찾는다', async () => {
      const gateway = await create();
      const leaf = computeInvoiceLeaf({
        invoiceId: INVOICE_ID, faceAmount: FACE,
        ownerPk: deriveOwnerPublicKey(OWNER_SECRET),
      });
      expect(await gateway.hasInvoiceLeaf(leaf)).toBe(true);
    });

    /*
     * 검사가 헛돌지 않는지 본다.
     *
     * 소유자 키가 다르면 리프도 다르고, 그 신청은 회로에서 거부된다.
     * 여기서 true 가 나오면 위 검사는 아무것도 확인하지 않는 셈이다.
     */
    it('소유자 키가 다르면 같은 채권이라도 리프를 찾지 못한다', async () => {
      const gateway = await create();
      const leaf = computeInvoiceLeaf({
        invoiceId: INVOICE_ID, faceAmount: FACE,
        ownerPk: deriveOwnerPublicKey(`0x${'3b'.repeat(32)}` as Hex),
      });
      expect(await gateway.hasInvoiceLeaf(leaf)).toBe(false);
    });

    it('등록된 금융사에 예치금이 있다', async () => {
      const gateway = await create();
      expect(await gateway.getLenderVault('lender-a')).toBeGreaterThan(0n);
    });

    it('공개 원장 행에 채권 원문 필드가 없다', async () => {
      const gateway = await create();
      for (const loan of await gateway.listLoans()) {
        expect(Object.keys(loan).sort()).toEqual([...PUBLIC_LOAN_FIELDS].sort());
      }
    });
  });
}

/** 쓰기 계약. 서버가 서명하는 구현만 해당한다. */
export function chainWriterContract(name: string, create: () => Promise<Gateway>): void {
  describe(`ChainWriter 계약: ${name}`, () => {
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

    it('확정된 대출이 공개 원장에 원문 없이 올라간다', async () => {
      const gateway = await create();
      await gateway.submitFinancing({
        lender: 'lender-a', amount: 80_000_000n, recipient: RECIPIENT,
        witness: {
          invoiceId: INVOICE_ID, faceAmount: FACE,
          salt: `0x${'d1'.repeat(32)}` as Hex, ownerSecret: OWNER_SECRET,
        },
      });
      const loans = await gateway.listLoans();
      expect(loans).toHaveLength(1);
      expect(Object.keys(loans[0] ?? {}).sort()).toEqual([...PUBLIC_LOAN_FIELDS].sort());
    });
  });
}

/** 시뮬레이터를 데모 초기 상태로 세운다. 두 스위트가 같이 쓴다. */
export async function seededSimulator(): Promise<OnceContractSimulator> {
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
  return sim;
}

const localGateway = async () => new LocalCircuitChainGateway(fixedSource(await seededSimulator()));

chainReaderContract('LocalCircuitChainGateway', localGateway);
chainWriterContract('LocalCircuitChainGateway', localGateway);

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
