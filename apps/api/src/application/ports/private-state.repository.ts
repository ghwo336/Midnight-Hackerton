import type { Hex, InvoiceDetail, LenderId, PrivateInvoice } from '@once/domain';

/**
 * 채권 원문 저장소.
 *
 * 실제 제품에서는 납품업체 본인의 기기에 있어야 한다. 데모 편의를 위해
 * 서버가 보관하되 **역할별로 논리적으로 완전히 분리**한다 (SPEC §3.1).
 * 금융사 세션이 납품업체의 원문에 접근하는 경로가 코드에 존재하면 안 되므로,
 * 모든 조회가 supplierId를 요구한다.
 *
 * 나중에 브라우저 저장소로 교체할 수 있도록 인터페이스 뒤에 둔다.
 */
export interface PrivateStateRepository {
  saveInvoice(supplierId: string, invoice: PrivateInvoice): Promise<void>;
  findInvoice(supplierId: string, invoiceId: Hex): Promise<PrivateInvoice | null>;
  listInvoices(supplierId: string): Promise<readonly PrivateInvoice[]>;
  /** 심사 중인 금융사에만 오프체인으로 전달되는 상세 (CONTEXT §5) */
  discloseDetailTo(
    supplierId: string,
    invoiceId: Hex,
    lender: LenderId,
  ): Promise<InvoiceDetail | null>;
  getOwnerSecret(supplierId: string): Promise<Hex>;
}

export const PRIVATE_STATE_REPO = Symbol('PRIVATE_STATE_REPO');
