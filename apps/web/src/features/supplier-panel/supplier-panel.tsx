'use client';

import type { SupplierInvoice } from '@/shared/api/types';
import { InvoiceRow } from '@/entities/invoice/invoice-row';
import { formatAmount } from '@/shared/ui/format';

/**
 * 납품업체 패널 (DESIGN §4).
 *
 * 주요/보조 버튼을 색으로 구분하지 않는다. 배치 순서로 구분한다 (DESIGN §5.4).
 */
export function SupplierPanel({
  dimmed = false,
  invoices,
  selectedId,
  busy,
  onSelect,
  onRequest,
}: {
  dimmed?: boolean;
  invoices: readonly SupplierInvoice[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (invoiceId: string) => void;
  onRequest: (lender: 'lender-a' | 'lender-b') => void;
}) {
  const selected = invoices.find((invoice) => invoice.invoiceId === selectedId) ?? null;

  // 금액 산술을 프론트에서 하지 않는다 (SPEC §9.2). 문자열을 bigint로 합산만 한다.
  const sum = (items: readonly SupplierInvoice[], key: 'faceAmount' | 'maxLoanAmount') =>
    items.reduce((acc, item) => acc + BigInt(item[key]), 0n).toString();

  const totalFace = sum(invoices, 'faceAmount');
  const totalLimit = sum(invoices, 'maxLoanAmount');
  const usedCount = invoices.filter((invoice) => invoice.used).length;
  const remainingLimit = sum(
    invoices.filter((invoice) => !invoice.used),
    'maxLoanAmount',
  );

  return (
    <section className={`panel ${dimmed ? "panel--dimmed" : ""}`}>
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

        <div className="summary">
          <div className="stages__head">보유 현황</div>
          <div className="summary__row">
            <span className="summary__key">액면 합계</span>
            <span className="num">{formatAmount(totalFace)}</span>
          </div>
          <div className="summary__row">
            <span className="summary__key">담보 한도 합계</span>
            <span className="num">{formatAmount(totalLimit)}</span>
          </div>
          <div className="summary__row">
            <span className="summary__key">사용됨</span>
            <span className="num">
              {usedCount} / {invoices.length}
            </span>
          </div>
          <div className="summary__row">
            <span className="summary__key">잔여 한도</span>
            <span className="num">{formatAmount(remainingLimit)}</span>
          </div>
        </div>

        {/*
          비활성 버튼만 두면 눌러도 아무 일이 없어 고장으로 보인다.
          왜 못 누르는지 한 줄로 알려준다. 장식이 아니라 상태 설명이다.
        */}
        <p className={`hint ${selected ? "hint--ready" : ""}`}>
          {selected
            ? `채권 #${invoices.findIndex((i) => i.invoiceId === selectedId) + 1} 선택됨 · 신청 금액 ${formatAmount(selected.maxLoanAmount)}`
            : '채권을 먼저 선택하세요'}
        </p>

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
