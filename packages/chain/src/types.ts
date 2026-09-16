import type { Hex, LenderId } from '@once/domain';

/**
 * 회로에 넘길 비공개 입력. 이 타입은 apps/api의 공개 경로에 닿지 않는다.
 */
export interface FinancingWitnessInput {
  readonly invoiceId: Hex;
  readonly faceAmount: bigint;
  readonly salt: Hex;
  readonly ownerSecret: Hex;
}

export interface FinancingRequest {
  readonly lender: LenderId;
  readonly amount: bigint;
  readonly recipient: Hex;
  readonly witness: FinancingWitnessInput;
}

export interface SubmitResult {
  readonly nullifier: Hex;
  readonly commitment: Hex;
  readonly txHash: Hex;
  readonly block: number;
}

/** 공개 원장에서 읽어오는 대출 기록. 채권 원문 필드가 없다. */
export interface OnChainLoan {
  readonly nullifier: Hex;
  readonly lender: Hex;
  readonly amount: bigint;
  readonly commitment: Hex;
  /** 확정 트랜잭션. 로컬 실행에서는 시뮬레이터가 발급한다. */
  readonly txHash: Hex | null;
  readonly block: number;
  /** 확정 시각 (ISO). 원장 화면의 시각 컬럼에 쓰인다. */
  readonly settledAt: string | null;
}

export interface LedgerSnapshot {
  /** 이 컨트랙트 인스턴스의 주소. 상단 상태줄에 표시된다. */
  readonly contractAddress: string;
  readonly issuerId: Hex;
  readonly ltvBps: bigint;
  readonly nullifierCount: number;
  readonly loans: readonly OnChainLoan[];
  readonly lenderVault: ReadonlyMap<Hex, bigint>;
  readonly registeredLenders: readonly Hex[];
  readonly invoiceTreeSize: number;
}
