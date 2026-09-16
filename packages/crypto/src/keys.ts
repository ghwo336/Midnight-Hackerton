import type { Hex } from '@once/domain';
import { hashBytes32Vector, hexToBytes32, padTag, TAG } from './hash.js';

/** 회로 `ownerPublicKey`와 동일. */
export function deriveOwnerPublicKey(ownerSecret: Hex): Hex {
  return hashBytes32Vector([padTag(TAG.OWNER_PK), hexToBytes32(ownerSecret)]);
}

/** 회로 `issuerPublicKey`와 동일. */
export function deriveIssuerPublicKey(issuerSecret: Hex): Hex {
  return hashBytes32Vector([padTag(TAG.ISSUER_PK), hexToBytes32(issuerSecret)]);
}
