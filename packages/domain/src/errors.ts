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
  'LOAN_NOT_FOUND',
  'LOAN_ALREADY_REPAID',
  'REPAYMENT_BELOW_PRINCIPAL',
  'CLAIM_NOT_ON_CHAIN',
  'SERVER_CANNOT_SIGN',
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

export class LoanNotFoundError extends DomainError {
  constructor() {
    super('LOAN_NOT_FOUND', 'loan not found');
  }
}

export class LoanAlreadyRepaidError extends DomainError {
  constructor() {
    super('LOAN_ALREADY_REPAID', 'loan already repaid');
  }
}

export class RepaymentBelowPrincipalError extends DomainError {
  constructor() {
    super('REPAYMENT_BELOW_PRINCIPAL', 'repayment is below the principal');
  }
}

export class ChainSubmitFailedError extends DomainError {
  constructor() {
    super('CHAIN_SUBMIT_FAILED', 'chain submission failed');
  }
}

/**
 * 실제 체인에서는 서버가 서명하지 않는다.
 *
 * 개인키는 사용자 지갑에만 있다. 서버가 대신 서명할 수 있다면 사용자
 * 자산을 서버가 움직일 수 있다는 뜻이고, 그건 이 제품이 주장하는 구조가
 * 아니다. 시뮬레이터 전용 경로를 실제 체인에서 부르면 이 오류가 난다.
 */
export class ServerCannotSignError extends DomainError {
  constructor() {
    super('SERVER_CANNOT_SIGN', 'server holds no signing key on a real network');
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
  LOAN_NOT_FOUND: 404,
  LOAN_ALREADY_REPAID: 409,
  REPAYMENT_BELOW_PRINCIPAL: 422,
  // 보고와 원장이 어긋났다. 보낸 쪽 잘못이다.
  CLAIM_NOT_ON_CHAIN: 409,
  // 서버에 키가 없다. 다른 경로로 가야 한다는 뜻이지 실패가 아니다.
  SERVER_CANNOT_SIGN: 501,
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
  // once.compact 의 repay 회로
  LOAN_NOT_FOUND: 'loans.member(nf)',
  LOAN_ALREADY_REPAID: '!loan.repaid',
  REPAYMENT_BELOW_PRINCIPAL: 'amount >= loan.amount',
  // 회로 밖에서 발생하는 오류들
  INVOICE_NOT_FOUND: null,
  PROOF_GENERATION_FAILED: null,
  CHAIN_SUBMIT_FAILED: null,
  CLAIM_NOT_ON_CHAIN: null,
  SERVER_CANNOT_SIGN: null,
};

/**
 * 브라우저가 "체인에서 이렇게 됐다"고 보고한 결과가 원장과 어긋난다.
 *
 * 서명이 사용자 지갑으로 넘어간 뒤에는 서버가 결과를 목격하지 못한다.
 * 보고를 그대로 적으면 원장에 없는 대출을 금융사 화면에 띄울 수 있으므로,
 * 적기 전에 원장을 읽어 대조한다. 이 오류는 그 대조가 실패했다는 뜻이다.
 */
export class ClaimNotOnChainError extends DomainError {
  constructor() {
    super('CLAIM_NOT_ON_CHAIN', 'reported result does not match the ledger');
  }
}
