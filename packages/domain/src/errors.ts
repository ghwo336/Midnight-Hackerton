/**
 * 도메인 오류. 메시지에 비밀값을 넣지 않는다 (SPEC §0.1-5, §8.3).
 */
export const DOMAIN_ERROR_CODES = [
  'INVOICE_NOT_FOUND',
  'NULLIFIER_ALREADY_USED',
  'AMOUNT_EXCEEDS_LTV',
  'OWNERSHIP_VERIFY_FAILED',
  'LENDER_NOT_REGISTERED',
  'ISSUER_ATTESTATION_FAILED',
  'INSUFFICIENT_LENDER_FUNDING',
  'PROOF_GENERATION_FAILED',
  'CHAIN_SUBMIT_FAILED',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** 안전한 고정 메시지만 사용한다. 입력값을 문자열에 삽입하지 않는다. */
export class InvoiceNotFoundError extends DomainError {
  constructor() {
    super('INVOICE_NOT_FOUND', 'invoice not found');
  }
}

export class NullifierAlreadyUsedError extends DomainError {
  constructor() {
    super('NULLIFIER_ALREADY_USED', 'collateral already financed');
  }
}

export class AmountExceedsLtvError extends DomainError {
  constructor() {
    super('AMOUNT_EXCEEDS_LTV', 'requested amount exceeds collateral limit');
  }
}

export class OwnershipVerifyFailedError extends DomainError {
  constructor() {
    super('OWNERSHIP_VERIFY_FAILED', 'ownership verification failed');
  }
}

export class LenderNotRegisteredError extends DomainError {
  constructor() {
    super('LENDER_NOT_REGISTERED', 'lender is not registered');
  }
}

export class IssuerAttestationFailedError extends DomainError {
  constructor() {
    super('ISSUER_ATTESTATION_FAILED', 'invoice is not attested by the issuer');
  }
}

export class InsufficientLenderFundingError extends DomainError {
  constructor() {
    super('INSUFFICIENT_LENDER_FUNDING', 'lender funding is insufficient');
  }
}

export class ProofGenerationFailedError extends DomainError {
  constructor() {
    super('PROOF_GENERATION_FAILED', 'proof generation failed');
  }
}

export class ChainSubmitFailedError extends DomainError {
  constructor() {
    super('CHAIN_SUBMIT_FAILED', 'chain submission failed');
  }
}

export const ERROR_HTTP_MAP: Record<DomainErrorCode, number> = {
  INVOICE_NOT_FOUND: 404,
  NULLIFIER_ALREADY_USED: 409,
  AMOUNT_EXCEEDS_LTV: 422,
  OWNERSHIP_VERIFY_FAILED: 403,
  LENDER_NOT_REGISTERED: 403,
  ISSUER_ATTESTATION_FAILED: 403,
  INSUFFICIENT_LENDER_FUNDING: 409,
  PROOF_GENERATION_FAILED: 500,
  CHAIN_SUBMIT_FAILED: 502,
};

/**
 * 각 오류가 어느 회로 assert에서 걸린 것인지.
 *
 * once.compact의 실제 표현식을 그대로 옮긴다 (줄 번호는 주석 참조).
 * 화면 로그에 이걸 함께 보여줘야 "연출이 아니라 회로가 거부했다"가 읽힌다.
 * 회로를 고치면 여기도 같이 고쳐야 한다. 테스트가 문자열을 대조한다.
 */
export const CIRCUIT_ASSERT: Record<DomainErrorCode, string | null> = {
  // once.compact:152
  NULLIFIER_ALREADY_USED: '!usedNullifiers.member(nf)',
  // once.compact:151
  LENDER_NOT_REGISTERED: 'registeredLenders.member(lender)',
  // once.compact:142
  AMOUNT_EXCEEDS_LTV: 'amount * 10000 <= inv.faceAmount * ltvBps',
  // once.compact:138: 금액 위조와 타인 채권을 구분하지 않는다 (오라클 방지)
  ISSUER_ATTESTATION_FAILED: 'path.leaf == leaf',
  // once.compact:138 (소유권도 리프에 포함돼 같은 assert에서 걸린다)
  OWNERSHIP_VERIFY_FAILED: 'path.leaf == leaf',
  // once.compact:153,155
  INSUFFICIENT_LENDER_FUNDING: 'balance >= amount',
  // 회로 밖에서 발생하는 오류들
  INVOICE_NOT_FOUND: null,
  PROOF_GENERATION_FAILED: null,
  CHAIN_SUBMIT_FAILED: null,
};
