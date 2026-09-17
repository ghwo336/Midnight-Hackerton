import { describe, expect, it } from 'vitest';
import { LENDER_A_KEY, SUPPLIER_ADDRESS, buildScenario, invoiceAt } from '../fixtures/scenario.js';
import { ASSERT, expectCircuitReject } from '../fixtures/assert-reject.js';

/**
 * A3: 액면금액을 부풀려 한도를 넘겨 신청한다.
 * 기대: Merkle 리프가 달라져 발급자 인증 검증 실패.
 *
 * faceAmount는 리프 해시의 입력이므로, 부풀리면 트리에 없는 리프가 된다.
 */
describe('A3: 액면금액 부풀리기', () => {
  it('부풀린 금액은 발급자 트리에 없어 거부된다', async () => {
    const sim = await buildScenario();
    const invoice = invoiceAt(0); // 액면 1억, 한도 8천만

    // 부풀린 금액은 리프를 바꾼다 → 발급자 트리에 없는 채권이 된다.
    // 한도 검사(LTV)까지 가지도 못한다는 점이 중요하다.
    await expectCircuitReject(
      () => sim.finance(
        {
          lender: 'lender-a', amount: 800_000_000n, recipient: SUPPLIER_ADDRESS,
          witness: { ...invoice, faceAmount: 1_000_000_000n },
        },
        LENDER_A_KEY,
      ),
      ASSERT.LEAF_MISMATCH,
    );

    expect(sim.snapshot().nullifierCount).toBe(0);
    expect(sim.snapshot().lenderVault.get(LENDER_A_KEY)).toBe(1_000_000_000n);
  });

  it('금액을 속이지 않아도 한도를 넘으면 거부된다', async () => {
    const sim = await buildScenario();
    const invoice = invoiceAt(0);

    await expectCircuitReject(
      () => sim.finance(
        { lender: 'lender-a', amount: 80_000_001n, recipient: SUPPLIER_ADDRESS, witness: invoice },
        LENDER_A_KEY,
      ),
      ASSERT.LTV_EXCEEDED,
    );

    expect(sim.snapshot().nullifierCount).toBe(0);
  });

  it('한도 경계값은 통과한다', async () => {
    const sim = await buildScenario();
    const invoice = invoiceAt(0);
    const result = await sim.finance(
      { lender: 'lender-a', amount: 80_000_000n, recipient: SUPPLIER_ADDRESS, witness: invoice },
      LENDER_A_KEY,
    );
    expect(result.nullifier).toBeDefined();
  });
});
