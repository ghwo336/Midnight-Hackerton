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
  /**
   * 대출이 확정된 블록과 그 트랜잭션.
   *
   * **null 일 수 있다.** 온체인 원장은 대출 기록만 담고 그것을 만든
   * 트랜잭션은 담지 않는다. 액션 이력을 되짚어 복원하는데, 인덱서가 아직
   * 그 블록을 노출하지 않았으면 못 찾는다.
   *
   * 예전에는 못 찾으면 0 과 0x000…0 을 넣었다. 화면은 그걸 해시로 알고
   * 탐색기 링크를 만들었고, 그 링크는 404 였다. 없는 것은 없다고 말한다.
   */
  readonly block: number | null;
  readonly txHash: Hex | null;
  /** 확정 시각 (ISO). 원장 화면의 시각 컬럼. */
  readonly settledAt: string | null;
  readonly borrower: Hex;
  readonly repaid: boolean;
  readonly repaidBlock: number | null;
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
  /**
   * 이 리프가 발급자 트리에 있는가.
   *
   * 리프는 (invoiceId, faceAmount, ownerPk) 의 해시다. 원문이 아니므로
   * 물어보는 쪽이 이미 답을 아는 경우에만 의미가 있다 — 여기서 채권
   * 내용이 새지 않는다.
   *
   * 비공개 상태의 소유자 키가 체인에 올라간 것과 다르면 회로가
   * "invoice leaf mismatch" 로 거부한다. 신청할 때가 아니라 기동할 때
   * 그걸 알아채기 위한 것이다.
   */
  hasInvoiceLeaf(leaf: Hex): Promise<boolean>;
  getLtvBps(): Promise<bigint>;
  isNullifierUsed(nullifier: Hex): Promise<boolean>;
  listLoans(): Promise<readonly PublicLoanView[]>;
  getLenderVault(lender: LenderId): Promise<bigint>;
  /** 차주의 가용 자금. 원장에서 읽는다. 화면이 합산하지 않는다. */
  getBorrowerBalance(address: Hex): Promise<bigint>;
  getBlockHeight(): Promise<number>;
  getStatus(): Promise<ChainStatus>;
  /**
   * 캐시된 원장 뷰를 버린다.
   *
   * 방금 확정된 트랜잭션을 곧바로 읽어야 할 때만 쓴다. 브라우저가 서명한
   * 결과를 원장과 대조하는 경로가 그렇다 — 캐시가 몇 초 낡았다는 이유로
   * "체인에 없다" 고 판정하면 안 된다.
   *
   * 캐시가 없는 구현은 아무것도 하지 않으면 된다.
   */
  invalidate(): Promise<void>;
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

export interface RepaymentTx {
  readonly nullifier: Hex;
  readonly amount: bigint;
}

export interface ChainWriter {
  submitFinancing(tx: FinancingTx): Promise<TxResult>;
  /**
   * 상환. 담보를 되살리지 않는다.
   * 회로가 usedNullifiers 를 건드리지 않으므로 같은 채권은 여전히 막혀 있다.
   */
  submitRepayment(tx: RepaymentTx): Promise<TxResult>;
  registerInvoiceLeaf(leaf: Hex): Promise<void>;
}

export const CHAIN_READER = Symbol('CHAIN_READER');
export const CHAIN_WRITER = Symbol('CHAIN_WRITER');
