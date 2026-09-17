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

export interface SupplierInvoice {
  readonly invoiceId: string;
  readonly faceAmount: string;
  readonly maxLoanAmount: string;
  readonly used: boolean;
  readonly usedBy: LenderId | null;
  readonly usedBlock: number | null;
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
