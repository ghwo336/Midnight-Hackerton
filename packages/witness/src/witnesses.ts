import { pureCircuits, type Ledger, type Witnesses } from '@once/contract';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { OncePrivateState } from './private-state.js';

/** 회로가 요구하는 트리 깊이. once.compact의 MerkleTreePath<10, _>와 맞춘다. */
const TREE_DEPTH = 10;

/**
 * 리프가 트리에 없을 때 돌려줄 경로.
 *
 * 길이가 맞지 않으면 회로에 들어가기도 전에 타입 오류로 죽는다. 그러면
 * 거부는 되지만 **회로의 발급자 인증 검사를 실제로 통과한 것이 아니다**.
 * A3·A4가 검증하려는 것이 바로 그 검사이므로, 형태가 올바르고 내용이
 * 틀린 경로를 만들어 회로가 정상적으로 거부하게 한다.
 */
function unattestedPath(): {
  leaf: Uint8Array;
  path: { sibling: { field: bigint }; goes_left: boolean }[];
} {
  return {
    leaf: new Uint8Array(32),
    path: Array.from({ length: TREE_DEPTH }, () => ({
      sibling: { field: 0n },
      goes_left: false,
    })),
  };
}

/**
 * witness 구현. 비공개 상태에서만 값을 읽고, 어떤 값도 반환 경로 밖으로
 * 흘리지 않는다. 로깅하지 않는다 (SPEC §0.1-5).
 */
export const witnesses: Witnesses<OncePrivateState> = {
  privateInvoice: ({ privateState }: WitnessContext<Ledger, OncePrivateState>) => {
    const active = privateState.activeInvoice;
    if (!active) {
      throw new Error('no active invoice in private state');
    }
    return [
      privateState,
      { invoiceId: active.invoiceId, faceAmount: active.faceAmount, salt: active.salt },
    ];
  },

  ownerSecret: ({ privateState }: WitnessContext<Ledger, OncePrivateState>) => {
    const active = privateState.activeInvoice;
    if (!active) {
      throw new Error('no active invoice in private state');
    }
    return [privateState, active.ownerSecret];
  },

  /**
   * 발급자 Merkle 경로는 현재 원장 상태에서 유도한다.
   * 리프가 트리에 없으면 빈 경로를 돌려주고, 회로의 checkRoot가 거부한다.
   */
  invoicePath: ({ ledger, privateState }: WitnessContext<Ledger, OncePrivateState>) => {
    const active = privateState.activeInvoice;
    if (!active) {
      throw new Error('no active invoice in private state');
    }
    const ownerPk = pureCircuits.ownerPublicKey(active.ownerSecret);
    const leaf = pureCircuits.invoiceLeaf(active.invoiceId, active.faceAmount, ownerPk);
    const found = ledger.invoiceTree.findPathForLeaf(leaf);
    return [privateState, found ?? unattestedPath()];
  },

  issuerSecret: ({ privateState }: WitnessContext<Ledger, OncePrivateState>) => [
    privateState,
    privateState.issuerSecret,
  ],
};
