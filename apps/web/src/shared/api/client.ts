import type {
  AttackOutcome, ChainStatus, CheckDescriptor, ClaimResult, FinancingSettled, Identity,
  DisclosureField, InvoiceRequest, IssueInvoiceBody, IssueResult, IssuerState, LenderId,
  LenderState, LenderTermsList, LoanRow, RequestInvoiceBody, SupplierFunds, SupplierInvoice,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause: unknown) {
    const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
    throw new ApiError(
      timedOut ? 'API_TIMEOUT' : 'API_UNREACHABLE',
      timedOut
        ? `백엔드가 ${TIMEOUT_MS / 1000}초 안에 응답하지 않았다`
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
  attack: (id: string) => request<AttackOutcome>(`/demo/attack/${id}`, { method: 'POST' }),
  reset: () => request<{ ok: boolean }>('/demo/reset', { method: 'POST' }),
  eventsUrl: () => `${BASE}/api/public/events`,
};
