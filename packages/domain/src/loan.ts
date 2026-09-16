import type { Hex } from './hex.js';
import type { LenderId } from './invoice.js';

/**
 * 공개 원장에 실리는 대출 기록.
 * 컬럼은 이것만이다: nullifier, 금융사, 금액, 블록, tx (DESIGN §4.1).
 * 채권 내용 필드를 여기에 추가하지 않는다.
 */
export interface LoanRecord {
  readonly nullifier: Hex;
  readonly lender: LenderId;
  readonly amount: string;
  readonly commitment: Hex;
  readonly block: number;
  readonly txHash: Hex;
}

export interface FinancingResult {
  readonly nullifier: Hex;
  readonly commitment: Hex;
  readonly lender: LenderId;
  readonly amount: string;
  readonly txHash: Hex;
  readonly block: number;
}
