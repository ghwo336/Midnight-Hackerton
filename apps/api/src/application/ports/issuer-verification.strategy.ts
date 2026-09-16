import type { Hex, PrivateInvoice } from '@once/domain';

/**
 * OCP — 발급자 검증 방식이 바뀌어도 유스케이스를 수정하지 않는다 (SPEC §5).
 * 스파이크 S3 결과로 현재는 'merkle' 하나만 쓴다.
 */
export interface IssuerWitness {
  readonly leaf: Hex;
}

export interface IssuerVerificationStrategy {
  readonly kind: 'merkle' | 'signature' | 'public-set';
  buildWitness(invoice: PrivateInvoice): Promise<IssuerWitness>;
}

export const ISSUER_STRATEGY = Symbol('ISSUER_STRATEGY');
