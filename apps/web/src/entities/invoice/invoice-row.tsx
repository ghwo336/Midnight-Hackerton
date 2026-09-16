'use client';

import type { SupplierInvoice } from '@/shared/api/types';
import { formatAmount } from '@/shared/ui/format';

/**
 * 채권 행 (DESIGN §5.2).
 *
 * 액면금액과 한도만 표시한다. 구매기업명·지급일·승인번호는 애초에
 * 이 컴포넌트에 전달되지 않는다 — props 타입에 그런 필드가 없다.
 * 선택은 왼쪽 3px 보더로만 표시하고 배경색을 바꾸지 않는다.
 * 상태는 알약 배지가 아니라 텍스트다.
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

  return (
    <button type="button" className={className} onClick={onSelect} aria-pressed={selected}>
      <span className="invoice__top">
        <span className="invoice__name">채권 #{index + 1}</span>
        <span
          className={`invoice__state ${
            invoice.used ? 'invoice__state--used' : 'invoice__state--free'
          }`}
        >
          {invoice.used ? '사용됨' : '미사용'}
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
