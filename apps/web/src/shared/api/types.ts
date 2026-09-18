/**
 * 백엔드 응답 타입.
 *
 * 공개 원장 행에 채권 원문 필드가 없다. 추가하지 않는다 (DESIGN §4.1).
 * 프론트는 이 값을 표시만 한다. nullifier 계산이나 한도 검증을 하지 않는다.
 */
export type LenderId = 'lender-a' | 'lender-b';

export interface LoanRow {
  readonly nullifier: string;
  readonly lender: LenderId;
  readonly amount: string;
  readonly commitment: string;
  readonly block: number;
  readonly txHash: string;
  readonly settledAt: string | null;
  readonly borrower: string;
  /** 상환해도 담보는 풀리지 않는다. 같은 채권은 여전히 막혀 있다. */
  readonly repaid: boolean;
  readonly repaidBlock: number | null;
}

/**
 * 자금 상태.
 *
 * available 은 원장의 borrowerBalance 를 그대로 읽은 값이다. 화면이
 * 대출을 합산해 만든 값이 아니다.
 */
export interface SupplierFunds {
  readonly available: string;
  readonly positions: readonly LoanRow[];
  readonly outstandingCount: number;
  readonly outstandingTotal: string;
}

export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface InvoiceRequest {
  readonly id: string;
  readonly faceAmount: string;
  readonly requestedAt: string;
  readonly status: RequestStatus;
  readonly invoiceId: string | null;
  readonly risk: RiskProfile;
}

export interface RequestInvoiceBody {
  readonly faceAmount: string;
  readonly counterparty: string;
  readonly dueDate: string;
  readonly approvalNumber: string;
  readonly memo: string;
  readonly creditGrade: string;
  readonly dueWindow: string;
  readonly industry: string;
}

export interface ChainStatus {
  readonly network: string;
  /** false면 tx·블록이 시뮬레이터 값이다. 진짜처럼 표시하면 안 된다. */
  readonly simulated: boolean;
  readonly blockHeight: number;
  readonly contractAddress: string;
  readonly connected: boolean;
  readonly ltvBps: string;
}

/**
 * 심사에 쓰이는 위험 정보.
 *
 * 구매기업이 **누구인지는 빼고 얼마나 위험한지만** 남긴 값이다.
 * 같은 등급·구간·업종을 가진 회사가 여럿이라 하나로 특정되지 않는다.
 */
export interface RiskProfile {
  readonly creditGrade: string;
  readonly dueWindow: string;
  readonly industry: string;
}

export const DISCLOSURE_FIELDS = ['creditGrade', 'dueWindow', 'industry'] as const;
export type DisclosureField = (typeof DISCLOSURE_FIELDS)[number];

export const DISCLOSURE_LABEL: Record<DisclosureField, string> = {
  creditGrade: '채무자 신용등급',
  dueWindow: '지급 예정일 구간',
  industry: '업종 분류',
};

export interface SupplierInvoice {
  readonly invoiceId: string;
  readonly faceAmount: string;
  readonly maxLoanAmount: string;
  readonly used: boolean;
  readonly usedBy: LenderId | null;
  readonly usedBlock: number | null;
  /** 본인 채권이다. 무엇을 내줄지 고르려면 무엇이 있는지 봐야 한다. */
  readonly risk: RiskProfile;
}

/**
 * 심사 체크리스트 한 줄.
 *
 * `by`가 null이면 아무도 보지 않았다는 뜻이다. 화면이 그걸 통과로 그리면
 * 하지 않은 검증을 주장하게 된다.
 */
export type CheckKey = 'issuer' | 'ownership' | 'limit' | 'unused';
export type CheckState = 'pass' | 'fail' | 'skipped';
export type CheckVerifier = 'circuit' | 'pre-check';

export interface CheckResult {
  readonly state: CheckState;
  readonly by: CheckVerifier | null;
}

/** 라벨과 회로 표현식은 백엔드가 준다. 프론트가 지어내지 않는다. */
export interface CheckDescriptor {
  readonly key: CheckKey;
  readonly label: string;
  readonly assert: string;
}

/**
 * 금융사에 도착한 신청 한 건.
 *
 * 이 타입에 채권 원문 필드가 없다. 추가하지 않는다 (CONTEXT §4.1).
 * 금액과 중복 확인값은 확정되면 공개 원장에 올라가는 값이라 담는다.
 */
export interface ApplicationRow {
  readonly id: string;
  readonly lender: LenderId;
  readonly amount: string;
  readonly nullifier: string | null;
  readonly receivedAt: string;
  readonly outcome: 'settled' | 'rejected';
  readonly checks: Record<CheckKey, CheckResult>;
  readonly reason: string | null;
  readonly block: number | null;
  readonly txHash: string | null;
  readonly elapsedMs: number;
  /**
   * 납품업체가 이 금융사에만 내준 위험 정보.
   * 고른 항목만 키가 있다. 고르지 않은 항목은 키 자체가 없다.
   */
  readonly disclosed: Partial<RiskProfile>;
}

export interface LenderState {
  readonly lenderId: LenderId;
  readonly label: string;
  readonly vault: string;
  readonly ltvBps: string;
  readonly loans: readonly LoanRow[];
  readonly applications: readonly ApplicationRow[];
}

/**
 * 금융사 취급 조건. 전부 공개 원장에서 읽은 값이다.
 * 금리나 수수료 같은 없는 항목을 만들지 않는다.
 */
export interface LenderTerms {
  readonly lenderId: LenderId;
  readonly label: string;
  readonly vault: string;
}

export interface LenderTermsList {
  readonly lenders: readonly LenderTerms[];
  readonly ltvBps: string;
}

/**
 * 계정이 무엇을 할 수 있는가.
 *
 * 화면이 역할을 고르게 하지 않는다. 접속한 주소로 물어보고 그 결과로
 * 들어간다. issuer 는 여기 오지 않는다 — 발급 권한은 issuerSecret 을
 * 쥐고 있느냐로 정해지고 그 키는 브라우저에만 있어서 서버가 모른다.
 */
export type RoleKind = 'issuer' | 'supplier' | 'lender';

export interface Identity {
  readonly address: string;
  readonly roles: readonly RoleKind[];
  readonly lenderId: LenderId | null;
  readonly lenderLabel: string | null;
  readonly supplierId: string | null;
}

export interface ClaimResult {
  readonly ok: boolean;
  readonly lenderId?: LenderId | null;
  readonly lenderLabel?: string | null;
  readonly supplierId?: string;
  readonly reason: string | null;
}

/** 발급 기관 콘솔 상태. 전부 공개값이다. */
export interface IssuerState {
  readonly issuerId: string;
  /** 발급 기관 공개키. 이 기기가 발급 권한을 쥐었는지 대조한다. */
  readonly issuerPk: string;
  readonly issuerRoot: string;
  readonly invoiceCount: number;
  readonly ltvBps: string;
  readonly blockHeight: number;
}

/** 발급 결과. 원문은 돌아오지 않고 루트 전이만 온다. */
export interface IssueResult {
  readonly invoiceId: string;
  readonly rootBefore: string;
  readonly rootAfter: string;
  readonly invoiceCount: number;
}

export interface IssueInvoiceBody {
  readonly faceAmount: string;
  readonly counterparty: string;
  readonly dueDate: string;
  readonly approvalNumber: string;
  readonly memo: string;
}

export interface FinancingSettled {
  readonly nullifier: string;
  readonly commitment: string;
  readonly lender: LenderId;
  readonly amount: string;
  readonly txHash: string;
  readonly block: number;
}

export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
}

export interface AttackOutcome {
  readonly id: string;
  readonly title: string;
  readonly expected: string;
  readonly blocked: boolean;
  readonly code: string;
  readonly fundsMoved: string;
  readonly note: string;
}

/**
 * `/supplier/financing/prepare` 의 응답.
 *
 * 브라우저가 finance 회로를 부르는 데 필요한 것 전부다. `witness` 는
 * 납품업체 본인의 채권 원문이고 회로 입력으로만 쓰인다. 트랜잭션에는
 * nullifier 와 commitment 만 남는다.
 */
export interface FinancingPlanResponse {
  readonly applicationId: string;
  readonly receivedAt: string;
  readonly lenderKey: string;
  readonly recipient: string;
  readonly amount: string;
  readonly nullifier: string;
  readonly witness: {
    readonly invoiceId: string;
    readonly faceAmount: string;
    readonly salt: string;
    readonly ownerSecret: string;
  };
  readonly disclosed: Record<string, string>;
}

/** 브라우저가 체인에 무엇을 했는지 보고한다. 서버가 원장과 대조한다. */
export interface ConfirmFinancingBody {
  readonly applicationId: string;
  readonly invoiceId: string;
  readonly lenderId: LenderId;
  readonly amount: string;
  readonly nullifier: string;
  readonly receivedAt: string;
  readonly elapsedMs: number;
  readonly disclose: readonly DisclosureField[];
  readonly outcome: 'settled' | 'rejected';
  readonly txHash: string | null;
  readonly block: number | null;
  readonly reason: string | null;
}
