import type { Hex, LenderId } from '@once/domain';

/**
 * ISP: 읽기와 쓰기를 나눈다 (SPEC §5).
 * 조회만 하는 유스케이스가 지급 메서드에 접근하면 안 된다.
 */
export interface PublicLoanView {
  readonly nullifier: Hex;
  readonly lender: LenderId;
  readonly amount: string;
  readonly commitment: Hex;
  readonly block: number;
  readonly txHash: Hex;
  /** 확정 시각 (ISO). 원장 화면의 시각 컬럼. */
  readonly settledAt: string | null;
}

/** 상단 상태줄용. 체인 연결 상태를 화면이 표시만 한다. */
export interface ChainStatus {
  readonly network: string;
  /**
   * 이 체인이 실제 네트워크인가.
   *
   * false면 tx 해시와 블록 번호는 시뮬레이터가 만든 값이다. 화면이
   * 그걸 진짜 트랜잭션처럼 보여주면 거짓말이 된다.
   */
  readonly simulated: boolean;
  readonly blockHeight: number;
  readonly contractAddress: string;
  readonly connected: boolean;
  readonly ltvBps: string;
}

export interface ChainReader {
  getIssuerId(): Promise<Hex>;
  /**
   * 발급 기관 공개키. 원장에 있는 공개값이다.
   * 접속한 기기가 발급 권한을 쥐고 있는지 대조하는 데 쓰인다.
   */
  getIssuerPk(): Promise<Hex>;
  /**
   * 발급자 Merkle 루트. 공개값이다 (CONTEXT §5).
   * 발급 기관 화면이 표시하고, 금융사가 원문 없이 인증을 검증하는 기준이다.
   */
  getIssuerRoot(): Promise<Hex>;
  /** 발급 기관이 지금까지 등록한 채권 건수. 리프 개수일 뿐 내용이 아니다. */
  getInvoiceCount(): Promise<number>;
  getLtvBps(): Promise<bigint>;
  isNullifierUsed(nullifier: Hex): Promise<boolean>;
  listLoans(): Promise<readonly PublicLoanView[]>;
  getLenderVault(lender: LenderId): Promise<bigint>;
  getBlockHeight(): Promise<number>;
  getStatus(): Promise<ChainStatus>;
}

/** 증명 생성·제출 전이 시점. 실제로 그 지점을 지날 때만 호출된다. */
export type ChainStage = 'proving' | 'submitting';

export interface FinancingTx {
  readonly lender: LenderId;
  readonly amount: bigint;
  readonly recipient: Hex;
  readonly onStage?: (stage: ChainStage) => void;
  readonly witness: {
    readonly invoiceId: Hex;
    readonly faceAmount: bigint;
    readonly salt: Hex;
    readonly ownerSecret: Hex;
  };
}

export interface TxResult {
  readonly nullifier: Hex;
  readonly commitment: Hex;
  readonly txHash: Hex;
  readonly block: number;
}

export interface ChainWriter {
  submitFinancing(tx: FinancingTx): Promise<TxResult>;
  registerInvoiceLeaf(leaf: Hex): Promise<void>;
}

export const CHAIN_READER = Symbol('CHAIN_READER');
export const CHAIN_WRITER = Symbol('CHAIN_WRITER');
