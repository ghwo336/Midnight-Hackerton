/**
 * 백엔드 응답 타입.
 *
 * 공개 원장 행에 채권 원문 필드가 없다. 추가하지 않는다 (DESIGN §4.1).
 * 프론트는 이 값을 표시만 한다. nullifier 계산이나 한도 검증을 하지 않는다.
 */
export type LenderId = 'lender-a' | 'lender-b';

export interface LoanRow {
  readonly nullifier: string;
  readonly lender: LenderId;
  readonly amount: string;
  readonly commitment: string;
  readonly block: number;
  readonly txHash: string;
}

export interface SupplierInvoice {
  readonly invoiceId: string;
  readonly faceAmount: string;
  readonly maxLoanAmount: string;
  readonly used: boolean;
}

export interface LenderState {
  readonly lenderId: LenderId;
  readonly label: string;
  readonly vault: string;
  readonly loans: readonly LoanRow[];
}

export interface FinancingSettled {
  readonly nullifier: string;
  readonly commitment: string;
  readonly lender: LenderId;
  readonly amount: string;
  readonly txHash: string;
  readonly block: number;
}

export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
}

export interface AttackOutcome {
  readonly id: string;
  readonly title: string;
  readonly expected: string;
  readonly blocked: boolean;
  readonly code: string;
  readonly fundsMoved: string;
  readonly note: string;
}
