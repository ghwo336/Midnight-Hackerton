'use client';

import type { AttackOutcome } from '@/shared/api/types';
import { formatAmount } from '@/shared/ui/format';

export const ATTACK_IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'] as const;
export type AttackId = (typeof ATTACK_IDS)[number];

const TITLE: Record<AttackId, string> = {
  A1: '파일명·인코딩 변경',
  A2: '새 salt로 재봉인',
  A3: '액면금액 부풀리기',
  A4: '타인 채권',
  A5: '두 금융사 동시 신청',
  A6: '지연 제출',
};

export type AttackStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done'; readonly outcome: AttackOutcome };

function verdict(status: AttackStatus): { text: string; cls: string } {
  if (status.kind === 'idle') return { text: '미실행', cls: '' };
  if (status.kind === 'running') return { text: '실행 중', cls: '' };
  return status.outcome.blocked
    ? { text: '통과', cls: 'attack__verdict--pass' }
    : { text: '실패', cls: 'attack__verdict--fail' };
}

/**
 * 공격 패널 (SPEC §9.4).
 *
 * 6개 결과가 동시에 보인다. 마지막 하나만 아래에 띄우면 발표에서
 * "전부 막혔다"를 한눈에 보일 수 없다.
 *
 * 라이브로 누르는 버튼이므로 실패해도 화면이 깨지지 않게 오류를 정상
 * 경로로 처리한다. 백엔드도 예외를 던지지 않고 결과를 돌려준다.
 */
export function AttackPanel({
  statuses,
  busy,
  onRun,
  onReset,
}: {
  statuses: Record<AttackId, AttackStatus>;
  busy: boolean;
  onRun: (id: AttackId) => void;
  onReset: () => void;
}) {
  return (
    <section className="section">
      <header className="section__head">
        <span>공격 시나리오</span>
        <button type="button" className="btn" onClick={onReset} disabled={busy}>
          데모 초기화
        </button>
      </header>
      <div className="section__body">
        <div className="attacks">
          {ATTACK_IDS.map((id) => {
            const status = statuses[id];
            const v = verdict(status);
            const outcome = status.kind === 'done' ? status.outcome : null;
            return (
              <div className="attack" key={id}>
                <button
                  type="button"
                  className="btn attack__btn"
                  disabled={busy}
                  onClick={() => onRun(id)}
                >
                  {id}
                </button>
                <div className="attack__body">
                  <div className="attack__title">{TITLE[id]}</div>
                  <div className={`attack__verdict ${v.cls}`}>{v.text}</div>
                  <div className="attack__meta">
                    {outcome ? outcome.code : '—'}
                  </div>
                  <div className="attack__meta">
                    나간 자금{' '}
                    <span className="num">
                      {outcome ? formatAmount(outcome.fundsMoved) : '—'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
