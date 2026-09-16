'use client';

import type { SupplierInvoice } from '@/shared/api/types';
import { formatAmount } from '@/shared/ui/format';

const LENDER_LABEL: Record<string, string> = { 'lender-a': '금융사 A', 'lender-b': '금융사 B' };

/**
 * 채권 행 (DESIGN §5.2).
 *
 * 액면·한도·사용 정보만 표시한다. 구매기업명·지급일·승인번호는 props 타입에
 * 없어서 전달 자체가 불가능하다. 사용 정보는 공개 원장에서 온 값이다.
 */
export function InvoiceRow({
  invoice,
  index,
  selected,
  onSelect,
}: {
  invoice: SupplierInvoice;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const className = [
    'invoice',
    selected ? 'invoice--selected' : '',
    invoice.used ? 'invoice--used' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const usage = invoice.used
    ? `사용됨 · ${LENDER_LABEL[invoice.usedBy ?? ''] ?? '—'}${
        invoice.usedBlock === null ? '' : ` · 블록 ${invoice.usedBlock}`
      }`
    : '미사용';

  return (
    <button type="button" className={className} onClick={onSelect} aria-pressed={selected}>
      <span className="invoice__top">
        <span className="invoice__name">채권 #{index + 1}</span>
        <span
          className={`invoice__state ${
            invoice.used ? 'invoice__state--used' : 'invoice__state--free'
          }`}
        >
          {usage}
        </span>
      </span>
      <span className="invoice__line">
        액면 <span className="num">{formatAmount(invoice.faceAmount)}</span>
      </span>
      <br />
      <span className="invoice__line">
        한도 <span className="num">{formatAmount(invoice.maxLoanAmount)}</span>
      </span>
    </button>
  );
}
