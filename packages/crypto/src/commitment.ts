import type { Hex } from '@once/domain';
import { amountToBytes32, hashBytes32Vector, hexToBytes32, padTag, TAG } from './hash.js';

export interface CommitmentInput {
  readonly invoiceId: Hex;
  readonly faceAmount: bigint;
  readonly ownerPk: Hex;
  readonly salt: Hex;
}

/** INV-2: commitment = H(TAG_COMMITMENT, invoiceId, faceAmount, ownerPk, salt) */
export function computeCommitment(input: CommitmentInput): Hex {
  return hashBytes32Vector([
    padTag(TAG.COMMITMENT),
    hexToBytes32(input.invoiceId),
    amountToBytes32(input.faceAmount),
    hexToBytes32(input.ownerPk),
    hexToBytes32(input.salt),
  ]);
}

/** 발급자 Merkle 리프. salt를 포함하지 않는다. 같은 채권이면 같은 리프. */
export function computeInvoiceLeaf(input: {
  readonly invoiceId: Hex;
  readonly faceAmount: bigint;
  readonly ownerPk: Hex;
}): Hex {
  return hashBytes32Vector([
    padTag(TAG.LEAF),
    hexToBytes32(input.invoiceId),
    amountToBytes32(input.faceAmount),
    hexToBytes32(input.ownerPk),
  ]);
}
