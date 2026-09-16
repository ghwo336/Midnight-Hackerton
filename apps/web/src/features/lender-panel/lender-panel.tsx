'use client';

import type { LenderId, LenderState } from '@/shared/api/types';
import { EMPTY, formatAmount, shortHash } from '@/shared/ui/format';
import { Stamp, type StampState } from './stamp';

export interface LenderOutcome {
  readonly state: StampState;
  /** 거부 시 반드시 0이다. 자금이 나가지 않았다는 게 제품의 주장이다. */
  readonly amount: string;
  readonly txHash: string | null;
  readonly reason: string | null;
}

const STATUS_TEXT: Record<StampState, string> = {
  idle: '대기 중',
  pending: '증명 생성 중',
  settled: '지급 완료',
  rejected: '중복 담보 · 지급 거부',
};

const STATUS_CLASS: Record<StampState, string> = {
  idle: 'status--wait',
  pending: 'status--wait',
  settled: 'status--settled',
  rejected: 'status--rejected',
};

/**
 * 금융사 패널 (DESIGN §4, §5.3).
 *
 * 이 패널은 채권 내용을 받지 않는다. props에 채권 필드가 없다 —
 * "금융사 B 패널 어디에도 채권 내용이 없다"가 발표의 주장이므로
 * 전달 자체를 하지 않는다 (DESIGN §8).
 */
export function LenderPanel({
  lender,
  role,
  outcome,
}: {
  lender: LenderState | null;
  role: LenderId;
  outcome: LenderOutcome;
}) {
  const label = lender?.label ?? (role === 'lender-a' ? '금융사 A' : '금융사 B');

  return (
    <section className="panel">
      <header className="panel__head">
        <span>{label}</span>
        <span className="panel__role">대출 심사</span>
      </header>
      <div className="panel__body">
        <Stamp state={outcome.state} />

        <div className="readout">
          <div className="readout__row">
            <span className="readout__key">상태</span>
            <span className={`status ${STATUS_CLASS[outcome.state]}`}>
              {STATUS_TEXT[outcome.state]}
            </span>
          </div>
          <div className="readout__row">
            <span className="readout__key">지급 금액</span>
            <span className="num">{formatAmount(outcome.amount)}</span>
          </div>
          <div className="readout__row">
            <span className="readout__key">tx</span>
            <span className="num">{outcome.txHash ? shortHash(outcome.txHash) : EMPTY}</span>
          </div>
          <div className="readout__row">
            <span className="readout__key">예치 잔액</span>
            <span className="num">{lender ? formatAmount(lender.vault) : EMPTY}</span>
          </div>
        </div>

        {outcome.state === 'rejected' ? (
          <p className="reject-note">이 채권은 다른 금융사에서 사용 승인되었습니다</p>
        ) : null}
      </div>
    </section>
  );
}
