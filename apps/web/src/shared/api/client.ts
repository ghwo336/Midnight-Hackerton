import type {
  AttackOutcome, ChainStatus, CheckDescriptor, ClaimResult, FinancingSettled, Identity,
  DisclosureField, InvoiceRequest, IssueInvoiceBody, IssueResult, IssuerState, LenderId,
  LenderState, LenderTermsList, LoanRow, RequestInvoiceBody, SupplierFunds, SupplierInvoice,
  ConfirmFinancingBody, FinancingPlanResponse, IssuancePlanResponse, IssuanceConfirmed,
} from './types.js';

/**
 * 백엔드 클라이언트.
 * Midnight SDK를 직접 import하지 않는다. 모든 체인 접근은 api 경유다 (SPEC §9.2).
 */
/*
 * 기본값이 빈 문자열이다 = 같은 출처.
 *
 * next.config.mjs 의 rewrite 가 /api/* 를 백엔드로 넘긴다. 브라우저가
 * 다른 포트로 직접 요청하지 않으므로 CORS 도, 확장의 localhost 포트
 * 차단도 걸리지 않는다. 다른 호스트를 쓰려면 NEXT_PUBLIC_API_URL 로
 * 덮어쓴다.
 */
const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? '';

/**
 * 모든 요청에 상한을 건다.
 *
 * 무응답으로 매달리면 화면은 값이 '—' 인 채 멈추고 아무 오류도 나지
 * 않는다. 원인을 좁힐 단서가 없는 형태로 실패한다. 차라리 빨리 실패하고
 * 무엇이 안 됐는지 말하게 한다.
 */
const TIMEOUT_MS = 8000;

/**
 * 체인을 읽어 대조하는 요청은 더 오래 걸린다.
 *
 * 브라우저가 서명한 결과를 기록하기 전에 서버가 원장을 다시 읽는다.
 * 인덱서가 방금 블록을 아직 노출하지 않았으면 기다렸다 한 번 더 본다.
 * 8초로 끊으면 정상 동작이 타임아웃으로 보인다.
 */
const CHAIN_TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** 어느 회로 assert에서 걸렸는지. 회로 밖 오류면 null. */
    readonly circuitAssert: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  timeoutMs: number = TIMEOUT_MS,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause: unknown) {
    const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
    throw new ApiError(
      timedOut ? 'API_TIMEOUT' : 'API_UNREACHABLE',
      timedOut
        ? `백엔드가 ${timeoutMs / 1000}초 안에 응답하지 않았다`
        : '백엔드에 연결하지 못했다',
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { code?: string; message?: string; circuitAssert?: string | null }
      | null;
    throw new ApiError(
      body?.code ?? 'UNKNOWN',
      body?.message ?? 'request failed',
      body?.circuitAssert ?? null,
    );
  }
  return (await response.json()) as T;
}

export const api = {
  chain: () => request<ChainStatus>('/public/chain'),
  loans: () => request<{ loans: LoanRow[] }>('/public/loans').then((r) => r.loans),
  invoices: () => request<{ invoices: SupplierInvoice[] }>('/supplier/invoices').then((r) => r.invoices),
  funds: () => request<SupplierFunds>('/supplier/funds'),
  repay: (nullifier: string) =>
    request<{ nullifier: string; amount: string; block: number }>('/supplier/repay', {
      method: 'POST',
      body: JSON.stringify({ nullifier }),
    }),
  myRequests: () =>
    request<{ requests: InvoiceRequest[] }>('/supplier/requests').then((r) => r.requests),
  requestInvoice: (body: RequestInvoiceBody) =>
    request<InvoiceRequest>('/supplier/requests', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  pendingRequests: () =>
    request<{ requests: InvoiceRequest[] }>('/issuer/requests').then((r) => r.requests),
  approveRequest: (requestId: string) =>
    request<IssueResult & { requestId: string }>('/issuer/requests/approve', {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    }),
  identity: (address: string) =>
    request<Identity>(`/identity/${encodeURIComponent(address)}`),
  claimRole: (address: string, role: 'lender' | 'supplier') =>
    request<ClaimResult>('/identity/claim', {
      method: 'POST',
      body: JSON.stringify({ address, role }),
    }),
  lenderTerms: () => request<LenderTermsList>('/public/lenders'),
  lender: (id: LenderId) => request<LenderState>(`/lender/${id}`),
  lenderChecks: () =>
    request<{ checks: CheckDescriptor[] }>('/lender/checks').then((r) => r.checks),
  issuer: () => request<IssuerState>('/issuer/state'),
  issueInvoice: (body: IssueInvoiceBody) =>
    request<IssueResult>('/issuer/invoices', { method: 'POST', body: JSON.stringify(body) }),

  /**
   * 발급 준비. 실제 체인 경로의 첫 단계다.
   *
   * 돌아오는 것은 리프 해시와 발급 식별자뿐이다. 서명·제출은 브라우저가
   * 하고, 발급 기관 비밀키는 이 기기의 IndexedDB 에서 witness 로 들어간다.
   */
  prepareIssue: (body: IssueInvoiceBody) =>
    request<IssuancePlanResponse>('/issuer/invoices/prepare', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** 등록 요청 승인 준비. 같은 회로를 같은 방식으로 부른다. */
  prepareApprove: (requestId: string) =>
    request<IssuancePlanResponse>('/issuer/requests/approve/prepare', {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    }),

  /** 리프를 올렸다는 보고. 서버가 발급자 트리에서 확인한 뒤에만 기록한다. */
  confirmIssue: (issuanceId: string, txHash: string | null, block: number | null) =>
    request<IssuanceConfirmed>(
      '/issuer/invoices/confirm',
      { method: 'POST', body: JSON.stringify({ issuanceId, txHash, block }) },
      CHAIN_TIMEOUT_MS,
    ),
  finance: (
    invoiceId: string,
    lenderId: LenderId,
    amount: string,
    /** 이 금융사에 내줄 항목. 비우면 아무것도 내주지 않는다. */
    disclose: readonly DisclosureField[] = [],
  ) =>
    request<FinancingSettled>('/supplier/financing', {
      method: 'POST',
      body: JSON.stringify({ invoiceId, lenderId, amount, disclose }),
    }),
  /**
   * 신청 준비. 실제 체인 경로의 첫 단계다.
   *
   * 서버가 사전 검사를 하고 회로에 넣을 재료를 돌려준다. 서명·증명·제출은
   * 브라우저가 한다. 돌아오는 채권 원문은 **납품업체 본인 것**이고, 이
   * 응답에서 금융사 화면으로 이어지는 길은 없다.
   */
  prepareFinancing: (
    invoiceId: string,
    lenderId: LenderId,
    amount: string,
    disclose: readonly DisclosureField[] = [],
  ) =>
    request<FinancingPlanResponse>('/supplier/financing/prepare', {
      method: 'POST',
      body: JSON.stringify({ invoiceId, lenderId, amount, disclose }),
    }),

  /** 브라우저가 낸 결과 보고. 서버가 원장과 대조한 뒤에만 기록된다. */
  confirmFinancing: (body: ConfirmFinancingBody) =>
    request<{ recorded: true }>(
      '/supplier/financing/confirm',
      { method: 'POST', body: JSON.stringify(body) },
      CHAIN_TIMEOUT_MS,
    ),

  /** 상환 보고. 원장에서 repaid 를 확인한 뒤에만 이벤트가 나간다. */
  confirmRepay: (nullifier: string, txHash: string | null, block: number | null) =>
    request<{ nullifier: string; amount: string }>(
      '/supplier/repay/confirm',
      { method: 'POST', body: JSON.stringify({ nullifier, txHash, block }) },
      CHAIN_TIMEOUT_MS,
    ),

  attack: (id: string) => request<AttackOutcome>(`/demo/attack/${id}`, { method: 'POST' }),
  reset: () => request<{ ok: boolean }>('/demo/reset', { method: 'POST' }),
  eventsUrl: () => `${BASE}/api/public/events`,
};
