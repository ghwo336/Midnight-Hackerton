import { describe, expect, it } from 'vitest';
import {
  LENDER_A_KEY, LENDER_B_KEY, LENDER_FUNDING, SUPPLIER_ADDRESS, buildScenario, invoiceAt,
} from '../fixtures/scenario.js';
import { ASSERT, expectCircuitReject } from '../fixtures/assert-reject.js';

/**
 * A6: 미사용 시점에 만든 증명을 사용 후에 제출한다.
 * 기대: 실행 시점 재검사로 거부 (INV-3).
 *
 * 이 테스트가 제품의 보안 주장 그 자체다 (SPEC §10.2).
 * 회로 안의 assert가 증명 생성 시점이 아니라 실행 시점의 공개 상태를
 * 본다는 것이 여기서 증명된다.
 */
describe('A6: 지연 제출 (stale proof)', () => {
  it('미사용 시점에 준비한 신청이 사용 후에는 거부된다', async () => {
    const sim = await buildScenario();
    const invoice = invoiceAt(0);

    // T0: 이 시점에 B가 증명을 만든다. 아직 미사용이다.
    expect(sim.isNullifierUsed(
      (await import('@once/crypto')).computeNullifier(
        sim.snapshot().issuerId,
        invoice.invoiceId,
      ),
    )).toBe(false);

    const staleRequest = {
      lender: 'lender-b' as const,
      amount: 80_000_000n,
      recipient: SUPPLIER_ADDRESS,
      witness: invoice,
    };

    // T1: 그 사이 A가 같은 채권으로 대출을 확정한다.
    await sim.finance(
      { lender: 'lender-a', amount: 80_000_000n, recipient: SUPPLIER_ADDRESS, witness: invoice },
      LENDER_A_KEY,
    );

    // T2: B가 T0에 준비한 신청을 이제서야 제출한다.
    await expectCircuitReject(
      () => sim.finance(staleRequest, LENDER_B_KEY),
      ASSERT.NULLIFIER_USED,
    );

    const snap = sim.snapshot();
    expect(snap.nullifierCount).toBe(1);
    expect(snap.loans).toHaveLength(1);
    expect(snap.lenderVault.get(LENDER_B_KEY)).toBe(LENDER_FUNDING);
  });
});
