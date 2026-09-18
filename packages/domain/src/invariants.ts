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
  // 확정 시각. 블록 번호가 이미 공개이므로 같은 수준의 정보다.
  'settledAt',
] as const;

/**
 * 납품업체 본인 화면에 허용되는 필드.
 * usedBy·usedBlock은 공개 원장에서 읽어온 값이라 새로 드러나는 것이 없다.
 * 구매기업명·지급일·승인번호는 여기 없고, 앞으로도 추가하지 않는다.
 */
export const SUPPLIER_INVOICE_FIELDS = [
  'invoiceId',
  'faceAmount',
  'maxLoanAmount',
  'used',
  'usedBy',
  'usedBlock',
  /*
   * 위험 정보. 납품업체 본인 화면에만 있다.
   * 무엇을 내줄지 고르려면 무엇이 있는지 봐야 한다. 고르기 전에는 아무
   * 금융사에도 가지 않는다.
   */
  'risk',
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

/**
 * 여신 심사 화면에 허용되는 신청 필드.
 *
 * 금융사가 신청 한 건에 대해 볼 수 있는 전부다. 여기에 채권 원문 필드를
 * 추가하면 제품 주장이 무너진다 (CONTEXT §4.1).
 */
export const APPLICATION_FIELDS = [
  'id',
  'lender',
  // 금액과 중복 확인값은 확정되면 공개 원장에 올라가는 값이다
  'amount',
  'nullifier',
  'receivedAt',
  'outcome',
  'checks',
  'reason',
  'block',
  'txHash',
  'elapsedMs',
  /*
   * 납품업체가 이 금융사에만 내준 위험 정보. 고른 항목만 키가 있다.
   * 고르지 않은 항목은 값이 비는 게 아니라 키 자체가 없다.
   */
  'disclosed',
] as const;

/**
 * 금융사 상태 응답에 허용되는 최상위 필드.
 * 다른 금융사의 잔액이나 신청을 담는 필드를 추가하지 않는다.
 */
export const LENDER_STATE_FIELDS = [
  'lenderId',
  'label',
  'vault',
  'ltvBps',
  'loans',
  'applications',
] as const;
