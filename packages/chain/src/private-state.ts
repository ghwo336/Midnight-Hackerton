import { hexToBytes, type Hex } from '@once/domain';
import type { FinancingWitnessInput } from './types.js';

/**
 * 컨트랙트 비공개 상태. 회로 witness가 여기서만 값을 읽는다.
 *
 * 실제 제품에서는 납품업체 본인 기기에 있어야 한다. 데모에서는
 * 역할별로 분리된 저장소가 이 객체를 만들어 넘긴다 (SPEC §3.1).
 */
export interface OncePrivateState {
  /** 발급 기관 권한 회로에서만 쓰인다. 납품업체 세션에는 존재하지 않는다. */
  readonly issuerSecret: Uint8Array;
  /** 현재 신청 중인 채권의 원문. 신청 밖에서는 null. */
  readonly activeInvoice: ActiveInvoice | null;
}

export interface ActiveInvoice {
  readonly invoiceId: Uint8Array;
  readonly faceAmount: bigint;
  readonly salt: Uint8Array;
  readonly ownerSecret: Uint8Array;
}

const ZERO32 = new Uint8Array(32);

export function emptyPrivateState(): OncePrivateState {
  return { issuerSecret: ZERO32, activeInvoice: null };
}

export function issuerPrivateState(issuerSecret: Hex): OncePrivateState {
  return { issuerSecret: hexToBytes(issuerSecret), activeInvoice: null };
}

export function withActiveInvoice(
  base: OncePrivateState,
  input: FinancingWitnessInput,
): OncePrivateState {
  return {
    issuerSecret: base.issuerSecret,
    activeInvoice: {
      invoiceId: hexToBytes(input.invoiceId),
      faceAmount: input.faceAmount,
      salt: hexToBytes(input.salt),
      ownerSecret: hexToBytes(input.ownerSecret),
    },
  };
}
