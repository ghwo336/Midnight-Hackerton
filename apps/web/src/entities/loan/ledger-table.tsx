import type { LoanRow } from '@/shared/api/types';
import { EMPTY, formatAmount, shortHash } from '@/shared/ui/format';

const LENDER_LABEL: Record<string, string> = { 'lender-a': 'A', 'lender-b': 'B' };

function clock(iso: string | null): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

/**
 * 공개 원장 테이블.
 *
 * 컬럼은 중복 확인값 · 금융사 · 금액 · 봉인값 · 블록 · tx · 시각뿐이다.
 * 채권 내용 필드를 렌더링하는 코드가 여기에 존재해서는 안 된다 (DESIGN §4.1).
 * 숨기는 게 아니라 만들지 않는다.
 *
 * 새 행이 추가될 때 애니메이션을 넣지 않는다. 그냥 나타난다.
 */
export function LedgerTable({ loans }: { loans: readonly LoanRow[] }) {
  if (loans.length === 0) {
    return <p className="ledger__empty">아직 확정된 대출이 없다.</p>;
  }

  return (
    <table className="ledger">
      <colgroup>
        <col className="c-nullifier" />
        <col className="c-lender" />
        <col className="c-amount" />
        <col className="c-commitment" />
        <col className="c-block" />
        <col className="c-tx" />
        <col className="c-time" />
      </colgroup>
      <thead>
        <tr>
          <th className="hash">중복 확인값</th>
          <th>금융사</th>
          <th className="num">금액</th>
          <th className="hash">봉인값</th>
          <th className="num">블록</th>
          <th className="hash">tx</th>
          <th className="hash">시각</th>
        </tr>
      </thead>
      <tbody>
        {loans.map((loan) => (
          <tr key={loan.nullifier}>
            <td className="hash">{shortHash(loan.nullifier)}</td>
            <td>{LENDER_LABEL[loan.lender] ?? EMPTY}</td>
            <td className="num">{formatAmount(loan.amount)}</td>
            <td className="hash">{shortHash(loan.commitment)}</td>
            <td className="num">{loan.block}</td>
            <td className="hash">{shortHash(loan.txHash)}</td>
            <td className="hash">{clock(loan.settledAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
