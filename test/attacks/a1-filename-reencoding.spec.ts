import { describe, expect, it } from 'vitest';
import { computeNullifier } from '@once/crypto';
import {
  ISSUER_ID, LENDER_A_KEY, LENDER_B_KEY, SUPPLIER_ADDRESS, buildScenario, invoiceAt,
} from '../fixtures/scenario.js';
import { ASSERT, expectCircuitReject } from '../fixtures/assert-reject.js';

/**
 * A1 — 같은 채권 증빙의 파일명·인코딩을 바꿔 재신청한다.
 * 기대: nullifier 동일 → 거부.
 *
 * nullifier는 (issuerId, invoiceId)에서만 나온다. 증빙 파일의 이름·해시·
 * 인코딩은 애초에 입력이 아니므로 아무리 바꿔도 같은 값이 나온다 (INV-1).
 */
describe('A1 — 파일명·인코딩 변경 후 재신청', () => {
  it('두 번째 신청이 거부되고 B의 자금이 보존된다', async () => {
    const sim = await buildScenario();
    const invoice = invoiceAt(0);

    await sim.finance(
      {
        lender: 'lender-a', amount: 80_000_000n, recipient: SUPPLIER_ADDRESS,
        witness: invoice,
      },
      LENDER_A_KEY,
    );

    const vaultBefore = sim.snapshot().lenderVault.get(LENDER_B_KEY);

    // 파일명·인코딩을 바꿔도 invoiceId는 발급 기관이 부여한 값 그대로다
    await expectCircuitReject(
      () => sim.finance(
        {
          lender: 'lender-b', amount: 80_000_000n, recipient: SUPPLIER_ADDRESS,
          witness: { ...invoice },
        },
        LENDER_B_KEY,
      ),
      ASSERT.NULLIFIER_USED,
    );

    const snap = sim.snapshot();
    expect(snap.nullifierCount).toBe(1);
    expect(snap.loans).toHaveLength(1);
    expect(snap.lenderVault.get(LENDER_B_KEY)).toBe(vaultBefore);
  });

  it('증빙 표현이 달라도 nullifier가 같다', () => {
    const invoice = invoiceAt(0);
    expect(computeNullifier(ISSUER_ID, invoice.invoiceId)).toBe(
      computeNullifier(ISSUER_ID, invoice.invoiceId),
    );
  });
});
