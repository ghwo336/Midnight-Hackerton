import type {
  AttackOutcome, ChainStatus, FinancingSettled, LenderId, LenderState, LoanRow, SupplierInvoice,
} from './types.js';

/**
 * 백엔드 클라이언트.
 * Midnight SDK를 직접 import하지 않는다. 모든 체인 접근은 api 경유다 (SPEC §9.2).
 */
const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3011';

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
  const response = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });

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
  lender: (id: LenderId) => request<LenderState>(`/lender/${id}`),
  finance: (invoiceId: string, lenderId: LenderId, amount: string) =>
    request<FinancingSettled>('/supplier/financing', {
      method: 'POST',
      body: JSON.stringify({ invoiceId, lenderId, amount }),
    }),
  attack: (id: string) => request<AttackOutcome>(`/demo/attack/${id}`, { method: 'POST' }),
  reset: () => request<{ ok: boolean }>('/demo/reset', { method: 'POST' }),
  eventsUrl: () => `${BASE}/api/public/events`,
};
