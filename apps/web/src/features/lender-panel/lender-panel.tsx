'use client';

import type { LenderId, LenderState, LoanRow } from '@/shared/api/types';
import { EMPTY, formatAmount, shortHash } from '@/shared/ui/format';
import {
  progressBar, resolveStamp, type LenderRuntime,
} from '@/features/demo-console/lender-runtime';
import { Stamp } from './stamp';
import { ExecutionLog } from './execution-log';

const STATUS_TEXT: Record<string, string> = {
  idle: '대기 중',
  pending: '심사 진행 중',
  settled: '지급 완료',
  rejected: '중복 담보 · 지급 거부',
};

const STATUS_CLASS: Record<string, string> = {
  idle: 'status--wait',
  pending: 'status--wait',
  settled: 'status--settled',
  rejected: 'status--rejected',
};

function ms(value: number | undefined): string {
  return value === undefined ? EMPTY : `${(value / 1000).toFixed(2)}s`;
}

/**
 * 금융사 패널.
 *
 * props에 채권 필드가 없다. "금융사 B 패널 어디에도 채권 내용이 없다"가
 * 발표의 주장이므로 전달 자체를 하지 않는다 (DESIGN §8).
 */
export function LenderPanel({
  role,
  label,
  lender,
  loan,
  runtime,
  elapsedMs,
}: {
  role: LenderId;
  label: string;
  lender: LenderState | null;
  loan: LoanRow | null;
  runtime: LenderRuntime;
  elapsedMs: number | null;
}) {
  const stamp = resolveStamp(runtime, loan);

  // 확정 금액은 원장이 진실이다. 거부면 0을 남긴다 — 자금이 나가지 않았다는 게 주장이다.
  const amount = stamp === 'settled' ? (loan?.amount ?? '0') : '0';
  const txHash = stamp === 'settled' ? (loan?.txHash ?? null) : null;
  const block = stamp === 'settled' ? (loan?.block ?? runtime.block) : null;

  const inFlight = stamp === 'pending';
  const proving = runtime.stageMs['proving'] ?? runtime.stageMs['witness'];

  return (
    <section className="panel">
      <header className="panel__head">
        <span>{label}</span>
        <span className="panel__role">대출 심사</span>
      </header>

      <div className="panel__body">
        <Stamp state={stamp} />

        <div className="readout">
          <div className="readout__row">
            <span className="readout__key">상태</span>
            <span className={`status ${STATUS_CLASS[stamp]}`}>{STATUS_TEXT[stamp]}</span>
          </div>
          <div className="readout__row">
            <span className="readout__key">지급 금액</span>
            <span className="num">{formatAmount(amount)}</span>
          </div>
          <div className="readout__row">
            <span className="readout__key">예치 잔액</span>
            <span className="num">{lender ? formatAmount(lender.vault) : EMPTY}</span>
          </div>
        </div>

        <div className="stages">
          <div className="stages__head">진행 단계</div>
          <div className="readout__row">
            <span className="readout__key">증명 생성</span>
            <span className="num">
              {inFlight ? (
                <>
                  <span className="bar">{progressBar(runtime.phase)}</span>{' '}
                  {elapsedMs === null ? EMPTY : `${(elapsedMs / 1000).toFixed(1)}s`}
                </>
              ) : (
                ms(proving)
              )}
            </span>
          </div>
          <div className="readout__row">
            <span className="readout__key">트랜잭션 제출</span>
            <span className="num">
              {runtime.stageMs['submitting'] !== undefined ? '✓' : EMPTY}
            </span>
          </div>
          <div className="readout__row">
            <span className="readout__key">확정</span>
            <span className="num">{block === null ? EMPTY : `블록 ${block}`}</span>
          </div>
          <div className="readout__row">
            <span className="readout__key">tx</span>
            <span className="num">{txHash ? shortHash(txHash) : EMPTY}</span>
          </div>
        </div>

        {stamp === 'rejected' ? (
          <p className="reject-note">이 채권은 다른 금융사에서 사용 승인되었습니다</p>
        ) : null}

        <div className="stages__head">실행 로그</div>
        <ExecutionLog lines={runtime.log} />
      </div>
    </section>
  );
}

export { type LenderId };
