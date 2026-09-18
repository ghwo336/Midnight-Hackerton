import { describe, expect, it } from 'vitest';
import { deriveOwnerPublicKey, computeInvoiceLeaf } from '@once/crypto';
import type { Hex } from '@once/domain';
import { DEMO } from '../../apps/web/src/shared/wallet/demo-fixtures.js';
import {
  DEMO_INVOICE_IDS, LENDER_FUNDING, LENDER_KEYS, loadEnv,
} from '../../apps/api/src/config/demo.config.js';

/**
 * 배포 경로와 서버가 **같은 채권을 가리키는지** 고정한다.
 *
 * 온체인 채권 리프는 (invoiceId, faceAmount, ownerPk) 의 해시다. 브라우저
 * 배포 경로가 쓰는 값과 서버가 비공개 상태로 되살리는 값이 갈라지면
 * 리프가 달라지고, 그 신청은 회로의 `assert(path.leaf == leaf)` 에서
 * 거부된다. 그 시점에는 "invoice leaf mismatch" 라는 회로 메시지만 남아
 * 원인이 값 불일치라는 걸 알기 어렵다.
 *
 * 실제로 한 번 겪었다: .env 의 SUPPLIER_SECRET_KEY 가 무작위 값이었고
 * 배포된 리프는 데모 키의 것이었다. 기동은 멀쩡했고 신청만 실패했다.
 */
describe('배포 고정값 결합', () => {
  it('채권 식별자가 브라우저 배포 경로와 서버에서 같다', () => {
    expect(DEMO.invoices.map((invoice) => invoice.id)).toEqual([...DEMO_INVOICE_IDS]);
  });

  it('금융사 키가 양쪽에서 같다', () => {
    expect(DEMO.lenders.map((lender) => lender.key)).toEqual([
      LENDER_KEYS['lender-a'],
      LENDER_KEYS['lender-b'],
    ]);
  });

  it('금융사 예치 금액이 양쪽에서 같다', () => {
    expect(DEMO.funding).toBe(LENDER_FUNDING);
  });

  /*
   * 소유자 키가 어긋나면 리프 전부가 달라진다. 액면가와 함께 확인해야
   * 의미가 있다 — 식별자만 같고 액면가가 다르면 역시 다른 리프다.
   */
  it('서버의 공급자 키로 계산한 리프가 배포 경로의 리프와 같다', () => {
    const fromBrowser = deriveOwnerPublicKey(DEMO.supplierSecret as Hex);
    const fromServer = deriveOwnerPublicKey(loadEnv().SUPPLIER_SECRET_KEY as Hex);

    for (const invoice of DEMO.invoices) {
      const leafBrowser = computeInvoiceLeaf({
        invoiceId: invoice.id as Hex, faceAmount: invoice.faceAmount, ownerPk: fromBrowser,
      });
      const leafServer = computeInvoiceLeaf({
        invoiceId: invoice.id as Hex, faceAmount: invoice.faceAmount, ownerPk: fromServer,
      });
      expect(leafServer).toBe(leafBrowser);
    }
  });
});
