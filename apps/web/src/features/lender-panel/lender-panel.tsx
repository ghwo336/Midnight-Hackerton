'use client';

import type { LenderId, LenderState, LoanRow } from '@/shared/api/types';
import { EMPTY, formatAmount, shortHash } from '@/shared/ui/format';
import {
  progressBar, resolveStamp, type LenderRuntime, type Reveal,
} from '@/features/demo-console/lender-runtime';
import { useCountUp } from '@/features/demo-console/use-reveal';
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

/** A5에서 두 패널의 잔액을 나란히 대비시키기 위한 표시. */
export interface VaultContrast {
  readonly kind: 'spent' | 'unchanged';
  readonly delta: string;
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
  reveal,
  vaultContrast,
  dimmed,
}: {
  role: LenderId;
  label: string;
  lender: LenderState | null;
  loan: LoanRow | null;
  runtime: LenderRuntime;
  elapsedMs: number | null;
  reveal: Reveal;
  vaultContrast: VaultContrast | null;
  dimmed: boolean;
}) {
  const settledStamp = resolveStamp(runtime, loan);
  // 도장은 노출 순서를 따른다. 아직 드러나기 전이면 진행 중으로 보인다.
  const stamp =
    !reveal.stamp && (settledStamp === 'settled' || settledStamp === 'rejected')
      ? 'pending'
      : settledStamp;

  const finalAmount = settledStamp === 'settled' ? (loan?.amount ?? '0') : '0';
  const amount = useCountUp(finalAmount, reveal.amounts);
  const vault = useCountUp(lender?.vault ?? '0', reveal.amounts);

  const txHash = settledStamp === 'settled' ? (loan?.txHash ?? null) : null;
  const block = settledStamp === 'settled' ? (loan?.block ?? runtime.block) : null;
  const inFlight = stamp === 'pending';
  const proving = runtime.stageMs['proving'] ?? runtime.stageMs['witness'];

  const shownLog = runtime.log.slice(0, reveal.logCount);
  const logProgress =
    runtime.log.length === 0 ? 0 : Math.min(shownLog.length / runtime.log.length, 1);

  // 도장이 찍히는 순간의 패널 반응 (확정=청색 플래시, 거부=흔들림+적색 플래시)
  const reaction =
    reveal.stamp && settledStamp === 'settled'
      ? 'panel--settled'
      : reveal.stamp && settledStamp === 'rejected'
        ? 'panel--rejected'
        : '';

  return (
    <section className={`panel ${reaction} ${dimmed ? 'panel--dimmed' : ''}`}>
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
          <div
            className={`readout__row ${
              vaultContrast ? `vault vault--${vaultContrast.kind}` : ''
            }`}
          >
            <span className="readout__key">예치 잔액</span>
            <span className="vault__values">
              {vaultContrast ? (
                <span className="vault__delta">{vaultContrast.delta}</span>
              ) : null}
              <span className="num">{lender ? formatAmount(vault) : EMPTY}</span>
            </span>
          </div>
        </div>

        <div className="stages">
          <div className="stages__head">
            진행 단계
            <span className="stages__bar" aria-hidden="true">
              <span className="stages__fill" style={{ width: `${logProgress * 100}%` }} />
            </span>
          </div>
          <div className="readout__row">
            <span className="readout__key">증명 생성</span>
            <span className="num">
              {inFlight ? (
                <>
                  <span className="bar">{progressBar(runtime.phase)}</span>{' '}
                  {elapsedMs === null ? EMPTY : `${(elapsedMs / 1000).toFixed(1)}s`}
                </>
              ) : reveal.stages ? (
                ms(proving)
              ) : (
                EMPTY
              )}
            </span>
          </div>
          <div className="readout__row">
            <span className="readout__key">트랜잭션 제출</span>
            <span className="num">
              {reveal.stages && runtime.stageMs['submitting'] !== undefined ? '✓' : EMPTY}
            </span>
          </div>
          <div className="readout__row">
            <span className="readout__key">확정</span>
            <span className="num">
              {reveal.stages && block !== null ? `블록 ${block}` : EMPTY}
            </span>
          </div>
          <div className="readout__row">
            <span className="readout__key">tx</span>
            <span className="num">{reveal.stages && txHash ? shortHash(txHash) : EMPTY}</span>
          </div>
        </div>

        {reveal.stamp && settledStamp === 'rejected' ? (
          <p className="reject-note">이 채권은 다른 금융사에서 사용 승인되었습니다</p>
        ) : null}

        <div className="stages__head">실행 로그</div>
        <ExecutionLog lines={shownLog} />
      </div>
    </section>
  );
}

export { type LenderId };
