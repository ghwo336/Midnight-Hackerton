import type { Hex } from '@once/domain';

/**
 * 인덱서에서 읽은 컨트랙트 액션 하나.
 *
 * 온체인 상태에는 "이 대출이 어느 트랜잭션에서 생겼는지" 가 없다. 원장은
 * nullifier → LoanRecord 만 들고 있고 tx 해시는 담지 않는다. 그래서 액션
 * 이력을 따로 받아 상태 변화와 맞춰야 화면이 진짜 tx 링크를 걸 수 있다.
 */
export interface ContractAction {
  readonly kind: 'deploy' | 'call' | 'update';
  readonly txHash: Hex;
  readonly block: number;
  /** 밀리초 단위 UNIX 시각. */
  readonly timestamp: number;
  /** 그 액션 직후의 컨트랙트 상태(직렬화된 바이트). */
  readonly state: Uint8Array;
}

export interface ChainTip {
  readonly height: number;
  readonly timestamp: number;
}
