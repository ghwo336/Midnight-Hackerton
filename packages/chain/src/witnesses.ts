import { pureCircuits, type Ledger, type Witnesses } from '@once/contract';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { OncePrivateState } from './private-state.js';

const EMPTY_PATH = {
  leaf: new Uint8Array(32),
  path: [] as { sibling: { field: bigint }; goes_left: boolean }[],
};

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
    return [privateState, found ?? EMPTY_PATH];
  },

  issuerSecret: ({ privateState }: WitnessContext<Ledger, OncePrivateState>) => [
    privateState,
    privateState.issuerSecret,
  ],
};
