import { describe, expect, it } from 'vitest';
import { deriveIssuerPublicKey, deriveOwnerPublicKey, computeInvoiceLeaf, computeNullifier } from '@once/crypto';
import { OnceContractSimulator } from '@once/chain';
import { NullifierAlreadyUsedError, type Hex } from '@once/domain';
import { LocalCircuitChainGateway } from '../../apps/api/src/infrastructure/chain/local-circuit.gateway.js';
import { fixedSource } from '../../apps/api/src/infrastructure/chain/simulator.source.js';
import { LENDER_FUNDING, LENDER_KEYS } from '../../apps/api/src/config/demo.config.js';

/**
 * A10: 상환은 담보를 되살리지 않는다.
 *
 * 매출채권은 한 번 쓰면 소멸하는 자산이다. 상환은 자금 관계를 정리하는
 * 것이지 담보를 복구하는 것이 아니다.
 *
 * 회로가 상환할 때 usedNullifiers 에서 nf 를 빼면, 상환 뒤 같은 채권으로
 * 다시 대출받을 수 있다. 그건 이 제품이 막으려는 바로 그 사기다. 누군가
 * "상환했으니 담보가 풀려야 하지 않나"라는 생각으로 그 줄을 추가하는
 * 순간 이 테스트가 실패한다.
 */
const ISSUER_ID = `0x${'11'.repeat(32)}` as Hex;
const ISSUER_SECRET = `0x${'5e'.repeat(32)}` as Hex;
const OWNER_SECRET = `0x${'7c'.repeat(32)}` as Hex;
const RECIPIENT = `0x${'cc'.repeat(32)}` as Hex;
const INVOICE_ID = `0x${'a1'.repeat(32)}` as Hex;
const FACE = 100_000_000n;
const LOAN = 80_000_000n;

async function setup() {
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
  const ownerPk = deriveOwnerPublicKey(OWNER_SECRET);
  await sim.registerInvoice(computeInvoiceLeaf({ invoiceId: INVOICE_ID, faceAmount: FACE, ownerPk }));

  const witness = {
    invoiceId: INVOICE_ID,
    faceAmount: FACE,
    salt: `0x${'d9'.repeat(32)}` as Hex,
    ownerSecret: OWNER_SECRET,
  };
  return { sim, witness, gateway: new LocalCircuitChainGateway(fixedSource(sim)) };
}

describe('A10: 상환이 담보를 되살리지 않는다', () => {
  it('상환 후 같은 채권으로 재신청하면 거부된다', async () => {
    const { sim, witness } = await setup();

    // 1. 대출
    const loan = await sim.finance(
      { lender: 'lender-a', amount: LOAN, recipient: RECIPIENT, witness },
      LENDER_KEYS['lender-a'],
    );
    expect(sim.snapshot().borrowerBalance.get(RECIPIENT)).toBe(LOAN);

    // 2. 상환
    await sim.repay({ nullifier: loan.nullifier, amount: LOAN });

    const afterRepay = sim.snapshot();
    expect(afterRepay.borrowerBalance.get(RECIPIENT)).toBe(0n);
    expect(afterRepay.lenderVault.get(LENDER_KEYS['lender-a'])).toBe(LENDER_FUNDING);
    expect(afterRepay.loans.find((l) => l.nullifier === loan.nullifier)?.repaid).toBe(true);

    // 3. **핵심**: 상환했어도 중복 확인값은 여전히 사용됨 상태다
    expect(sim.isNullifierUsed(loan.nullifier)).toBe(true);

    // 4. 같은 채권으로 다시 신청하면 회로가 거부한다
    await expect(
      sim.finance(
        { lender: 'lender-b', amount: LOAN, recipient: RECIPIENT, witness },
        LENDER_KEYS['lender-b'],
      ),
    ).rejects.toThrow(/nullifier already used/);

    // 5. 거부됐으므로 B 의 자금은 그대로다
    expect(sim.snapshot().lenderVault.get(LENDER_KEYS['lender-b'])).toBe(LENDER_FUNDING);
  });

  it('게이트웨이를 통해도 같은 도메인 오류가 나온다', async () => {
    const { sim, witness, gateway } = await setup();
    const loan = await gateway.submitFinancing({
      lender: 'lender-a', amount: LOAN, recipient: RECIPIENT, witness,
    });
    await gateway.submitRepayment({ nullifier: loan.nullifier, amount: LOAN });

    await expect(
      gateway.submitFinancing({
        lender: 'lender-b', amount: LOAN, recipient: RECIPIENT, witness,
      }),
    ).rejects.toBeInstanceOf(NullifierAlreadyUsedError);
    void sim;
  });

  it('두 번 상환할 수 없다', async () => {
    const { sim, witness } = await setup();
    const loan = await sim.finance(
      { lender: 'lender-a', amount: LOAN, recipient: RECIPIENT, witness },
      LENDER_KEYS['lender-a'],
    );
    await sim.repay({ nullifier: loan.nullifier, amount: LOAN });

    // 두 번째 상환이 통과하면 금융사 금고가 빌린 적 없는 자금으로 불어난다
    await expect(
      sim.repay({ nullifier: loan.nullifier, amount: LOAN }),
    ).rejects.toThrow(/already repaid/);
  });

  it('원금보다 적게 상환할 수 없다', async () => {
    const { sim, witness } = await setup();
    const loan = await sim.finance(
      { lender: 'lender-a', amount: LOAN, recipient: RECIPIENT, witness },
      LENDER_KEYS['lender-a'],
    );
    await expect(
      sim.repay({ nullifier: loan.nullifier, amount: LOAN - 1n }),
    ).rejects.toThrow(/repayment below principal/);
  });

  it('없는 대출은 상환할 수 없다', async () => {
    const { sim } = await setup();
    const ghost = computeNullifier(ISSUER_ID, `0x${'ff'.repeat(32)}` as Hex);
    await expect(sim.repay({ nullifier: ghost, amount: LOAN })).rejects.toThrow(/loan not found/);
  });
});
