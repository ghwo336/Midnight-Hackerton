/**
 * SPEC §1.1 핵심 불변식. 문서가 아니라 코드로 남긴다.
 *
 *   INV-1  nullifier  = H(TAG_NULLIFIER, issuerId, invoiceId)
 *          → salt, 금융사, 시각, 신청자, 파일명에 의존하지 않는다
 *   INV-2  commitment = H(TAG_COMMITMENT, invoiceId, faceAmount, ownerPk, salt)
 *          → salt를 포함한다
 *   INV-3  nullifier 미사용 검사와 자금 지급은 같은 트랜잭션에서 일어난다
 *          → 회로 finance 안의 실행 시점 검사로 강제된다
 */
export const INVARIANTS = {
  INV_1: 'nullifier depends only on (domain tag, issuerId, invoiceId)',
  INV_2: 'commitment includes a per-invoice salt',
  INV_3: 'nullifier check and disbursement happen in one transaction',
} as const;

/**
 * 공개 원장 및 공개 API에 허용되는 필드 화이트리스트.
 * 이 목록 밖의 필드가 공개 경로에 나타나면 A9가 실패한다 (SPEC §10.2).
 */
export const PUBLIC_LOAN_FIELDS = [
  'nullifier',
  'lender',
  'amount',
  'commitment',
  'block',
  'txHash',
] as const;

/** 공개 경로에 절대 나가면 안 되는 키 (SPEC §8.6). */
export const SECRET_FIELD_KEYS = [
  'salt',
  'ownerSecret',
  'issuerSecret',
  'merklePath',
  'invoicePath',
  'faceAmount',
  'counterparty',
  'approvalNumber',
  'dueDate',
  'memo',
  'invoiceRaw',
  'detail',
] as const;
