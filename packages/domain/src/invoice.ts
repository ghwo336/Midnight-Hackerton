import type { Hex } from './hex.js';

/** 금융사 식별자. 데모에서는 A, B 두 곳 (CONTEXT §8). */
export type LenderId = 'lender-a' | 'lender-b';

export const LENDER_IDS: readonly LenderId[] = ['lender-a', 'lender-b'];

export function isLenderId(value: string): value is LenderId {
  return (LENDER_IDS as readonly string[]).includes(value);
}

/**
 * 채권 원문. 납품업체만 보유한다.
 * 이 타입이 공개 응답·이벤트·로그에 실리는 경로가 있어서는 안 된다 (CONTEXT §4.1).
 */
export interface PrivateInvoice {
  /** 발급 기관 고유번호에서 유도. 복사·재발급해도 불변 (INV-1의 입력) */
  readonly invoiceId: Hex;
  readonly faceAmount: bigint;
  readonly salt: Hex;
  readonly ownerPk: Hex;
  /** 발급자 Merkle 트리에서의 리프 인덱스 */
  readonly leafIndex: number;
  /** 심사용 상세. 해당 금융사에만 오프체인으로 전달된다 (CONTEXT §5) */
  readonly detail: InvoiceDetail;
}

/** 심사용 상세 정보. 원장·공개 API에 절대 나가지 않는다. */
export interface InvoiceDetail {
  readonly counterparty: string;
  readonly dueDate: string;
  readonly approvalNumber: string;
  readonly memo: string;
}

/**
 * 납품업체 화면에 보여줄 최소 정보.
 * 다른 금융사 패널과 공개 원장에는 전달조차 하지 않는다 (DESIGN §5.2).
 */
export interface SupplierInvoiceView {
  readonly invoiceId: Hex;
  readonly faceAmount: string;
  readonly maxLoanAmount: string;
  readonly used: boolean;
}

/** 담보 한도. 정수 연산만 사용한다 (SPEC §0.1-3). */
export function maxLoanAmount(faceAmount: bigint, ltvBps: bigint): bigint {
  return (faceAmount * ltvBps) / 10_000n;
}

/** 회로의 `amount * 10000 <= faceAmount * ltvBps`와 같은 판정. */
export function isWithinLtv(amount: bigint, faceAmount: bigint, ltvBps: bigint): boolean {
  return amount * 10_000n <= faceAmount * ltvBps;
}
