'use client';

import type { SupplierInvoice } from '@/shared/api/types';
import { InvoiceRow } from '@/entities/invoice/invoice-row';

/**
 * 납품업체 패널 (DESIGN §4).
 *
 * 주요/보조 버튼을 색으로 구분하지 않는다. 배치 순서로 구분한다 (DESIGN §5.4).
 */
export function SupplierPanel({
  invoices,
  selectedId,
  busy,
  onSelect,
  onRequest,
}: {
  invoices: readonly SupplierInvoice[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (invoiceId: string) => void;
  onRequest: (lender: 'lender-a' | 'lender-b') => void;
}) {
  const selected = invoices.find((invoice) => invoice.invoiceId === selectedId) ?? null;

  return (
    <section className="panel">
      <header className="panel__head">
        <span>납품업체</span>
        <span className="panel__role">보유 채권 {invoices.length}건</span>
      </header>
      <div className="panel__body">
        {invoices.length === 0 ? (
          <p className="ledger__empty">—</p>
        ) : (
          invoices.map((invoice, index) => (
            <InvoiceRow
              key={invoice.invoiceId}
              invoice={invoice}
              index={index}
              selected={invoice.invoiceId === selectedId}
              onSelect={() => onSelect(invoice.invoiceId)}
            />
          ))
        )}

        <div className="btn-row">
          <button
            type="button"
            className="btn"
            disabled={!selected || busy}
            onClick={() => onRequest('lender-a')}
          >
            A에 신청
          </button>
          <button
            type="button"
            className="btn"
            disabled={!selected || busy}
            onClick={() => onRequest('lender-b')}
          >
            B에 신청
          </button>
        </div>
      </div>
    </section>
  );
}
