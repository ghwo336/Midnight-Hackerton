import type { InvoiceDetail, RiskProfile } from '@once/domain';

/**
 * 채권 등록 요청 큐.
 *
 * 납품업체가 "이런 채권이 있다"고 올리면 발급 기관이 확인하고 승인한다.
 * 승인해야 Merkle 리프가 들어가고 루트가 바뀐다. 발급 기관이 인증하지
 * 않은 채권은 회로의 checkRoot 에서 걸린다 (A4).
 *
 * 실제라면 세금계산서 원본 대조가 들어가는 자리다. 데모에서는 사람이
 * 눈으로 보고 누르는 것으로 대신한다.
 */
export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface InvoiceRequest {
  readonly id: string;
  readonly supplierId: string;
  readonly faceAmount: string;
  readonly detail: InvoiceDetail;
  readonly risk: RiskProfile;
  readonly requestedAt: string;
  status: RequestStatus;
  /** 승인되면 어떤 채권이 되었는지. */
  invoiceId: string | null;
}

export interface InvoiceRequestQueue {
  submit(entry: Omit<InvoiceRequest, 'id' | 'status' | 'invoiceId' | 'requestedAt'>): Promise<InvoiceRequest>;
  listFor(supplierId: string): Promise<readonly InvoiceRequest[]>;
  listPending(): Promise<readonly InvoiceRequest[]>;
  find(id: string): Promise<InvoiceRequest | null>;
  clear(): void;
}

export const INVOICE_REQUESTS = Symbol('INVOICE_REQUESTS');
