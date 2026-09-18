'use client';

import type { LoanRow, SupplierFunds } from '@/shared/api/types';
import { EMPTY, formatAmount, shortHash } from '@/shared/ui/format';
import { TX_PHASE_LABEL, type TxPhase } from '@/shared/runtime/tx-phase';

const LENDER_LABEL: Record<string, string> = {
  'lender-a': '금융사 A',
  'lender-b': '금융사 B',
};

function clock(iso: string | null): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes()].map((n) => String(n).padStart(2, '0')).join(':');
}

/**
 * 자금 상태와 포지션.
 *
 * available 은 원장의 borrowerBalance 를 그대로 읽은 값이다. 화면이 대출을
 * 합산해 만든 값이 아니므로, 상환하면 원장이 줄고 이 숫자가 따라 줄어든다.
 */
export function FundsPanel({
  funds,
  busy,
  phase,
  onRepay,
}: {
  funds: SupplierFunds | undefined;
  busy: string | null;
  /**
   * 실제 체인에서 상환 중일 때 지금 어느 구간인가.
   *
   * 지갑 승인과 블록 확정이 대부분의 시간을 먹는다. "상환 중" 한 마디만
   * 두면 30초 동안 멈춘 것처럼 보인다.
   */
  phase?: TxPhase | null;
  onRepay: (loan: LoanRow) => void;
}) {
  const positions = funds?.positions ?? [];
  const open = positions.filter((loan) => !loan.repaid);

  return (
    <>
      <section className="section">
        <header className="section__head">
          <span>가용 자금</span>
        </header>
        <div className="section__body">
          <p className="funds__amount num">
            {funds ? formatAmount(funds.available) : EMPTY}
          </p>
        </div>
      </section>

      <section className="section">
        <header className="section__head">
          <span>진행 중인 대출</span>
          <span className="panel__role">
            {funds
              ? `${funds.outstandingCount}건 · ${formatAmount(funds.outstandingTotal)}`
              : EMPTY}
          </span>
        </header>
        <div className="section__body">
          {positions.length === 0 ? (
            <p className="ledger__empty">실행 중인 대출이 없다.</p>
          ) : (
            positions.map((loan) => (
              <article
                key={loan.nullifier}
                className={`position ${loan.repaid ? 'position--repaid' : ''}`}
              >
                <header className="position__head">
                  <span className="position__lender">
                    {LENDER_LABEL[loan.lender] ?? loan.lender}
                  </span>
                  <span className="position__amount num">{formatAmount(loan.amount)}</span>
                  <span
                    className={`status ${loan.repaid ? 'status--settled' : 'status--wait'}`}
                  >
                    {loan.repaid ? '상환 완료' : '상환 전'}
                  </span>
                </header>

                <div className="position__meta">
                  <span className="position__cell">
                    <span className="readout__key">담보 채권</span>
                    <span className="num">{shortHash(loan.commitment)}</span>
                  </span>
                  <span className="position__cell">
                    <span className="readout__key">실행 블록</span>
                    <span className="num">{loan.block}</span>
                  </span>
                  <span className="position__cell">
                    <span className="readout__key">실행 시각</span>
                    <span className="num">{clock(loan.settledAt)}</span>
                  </span>
                  <span className="position__cell">
                    <span className="readout__key">상환 블록</span>
                    <span className="num">{loan.repaidBlock ?? EMPTY}</span>
                  </span>
                </div>

                {loan.repaid ? null : (
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn--inline"
                      disabled={busy !== null}
                      onClick={() => onRepay(loan)}
                    >
                      {busy === loan.nullifier ? '상환 중' : '상환'}
                    </button>
                    {busy === loan.nullifier && phase ? (
                      <span className="hint">{TX_PHASE_LABEL[phase]}</span>
                    ) : null}
                  </div>
                )}
              </article>
            ))
          )}
          {open.length > 0 ? (
            <p className="hint">원금만 상환한다. 이자는 계산하지 않는다.</p>
          ) : null}
        </div>
      </section>
    </>
  );
}
