import type { Hex, LenderId } from '@once/domain';

/**
 * ISP — 읽기와 쓰기를 나눈다 (SPEC §5).
 * 조회만 하는 유스케이스가 지급 메서드에 접근하면 안 된다.
 */
export interface PublicLoanView {
  readonly nullifier: Hex;
  readonly lender: LenderId;
  readonly amount: string;
  readonly commitment: Hex;
  readonly block: number;
  readonly txHash: Hex;
}

export interface ChainReader {
  getIssuerId(): Promise<Hex>;
  getLtvBps(): Promise<bigint>;
  isNullifierUsed(nullifier: Hex): Promise<boolean>;
  listLoans(): Promise<readonly PublicLoanView[]>;
  getLenderVault(lender: LenderId): Promise<bigint>;
  getBlockHeight(): Promise<number>;
}

export interface FinancingTx {
  readonly lender: LenderId;
  readonly amount: bigint;
  readonly recipient: Hex;
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
