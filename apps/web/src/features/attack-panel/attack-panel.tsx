'use client';

import type { AttackOutcome } from '@/shared/api/types';
import { formatAmount } from '@/shared/ui/format';

const ATTACKS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'] as const;

/**
 * 공격 패널 (SPEC §9.4).
 *
 * 발표 때 라이브로 누르는 버튼이므로, 실패해도 화면이 깨지지 않게
 * 오류를 정상 경로로 처리한다. 백엔드도 예외를 던지지 않고 결과를 돌려준다.
 */
export function AttackPanel({
  running,
  result,
  onRun,
  onReset,
}: {
  running: string | null;
  result: AttackOutcome | null;
  onRun: (id: string) => void;
  onReset: () => void;
}) {
  return (
    <section className="section">
      <header className="section__head">
        <span>공격 시나리오</span>
        <button type="button" className="btn" onClick={onReset} disabled={running !== null}>
          데모 초기화
        </button>
      </header>
      <div className="section__body">
        <div className="attacks">
          {ATTACKS.map((id) => (
            <button
              key={id}
              type="button"
              className="btn"
              disabled={running !== null}
              onClick={() => onRun(id)}
            >
              {running === id ? `${id} 실행 중` : id}
            </button>
          ))}
        </div>

        {result ? (
          <div className="attack-result">
            <div className="attack-result__head">
              <span>
                {result.id} {result.title}
              </span>
              <span
                className={`attack-result__verdict ${
                  result.blocked
                    ? 'attack-result__verdict--blocked'
                    : 'attack-result__verdict--settled'
                }`}
              >
                {result.blocked ? '거부됨' : '확정됨'}
              </span>
            </div>
            <div className="attack-result__meta">기대: {result.expected}</div>
            <div className="attack-result__meta">사유 코드: {result.code}</div>
            <div className="attack-result__meta">
              이 시도로 나간 자금: <span className="num">{formatAmount(result.fundsMoved)}</span>
            </div>
            <div className="attack-result__meta">{result.note}</div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
