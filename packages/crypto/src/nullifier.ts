import type { Hex } from '@once/domain';
import { hashBytes32Vector, hexToBytes32, padTag, TAG } from './hash.js';

/**
 * INV-1: nullifier = H(TAG_NULLIFIER, issuerId, invoiceId)
 *
 * 입력은 이 둘뿐이다. salt, 금융사, 시각, 신청자, 파일명이 들어오면
 * 같은 채권을 salt만 바꿔 무한 재사용할 수 있게 된다 (SPEC §13).
 * 이 함수의 시그니처를 넓히지 않는다.
 */
export function computeNullifier(issuerId: Hex, invoiceId: Hex): Hex {
  return hashBytes32Vector([
    padTag(TAG.NULLIFIER),
    hexToBytes32(issuerId),
    hexToBytes32(invoiceId),
  ]);
}
