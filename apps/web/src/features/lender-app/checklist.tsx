'use client';

import type { CheckDescriptor, CheckResult } from '@/shared/api/types';

/**
 * 검증 체크리스트.
 *
 * 세 가지 상태만 있다. 통과(✓) · 실패(✗) · 미평가(—).
 *
 * 미평가를 통과처럼 그리지 않는 게 이 컴포넌트의 전부다. 회로는 앞 assert가
 * 걸리면 뒤를 실행하지 않는다. 그걸 초록으로 칠하면 화면이 하지 않은
 * 검증을 주장하게 된다.
 *
 * 판정자(회로 / 사전)를 같이 적는다. 사전 검사는 보안 경계가 아니라
 * 응답을 빨리 돌려주려는 것이고, 같은 검사를 회로가 실행 시점에 다시 한다.
 */
const MARK: Record<CheckResult['state'], string> = {
  pass: '✓',
  fail: '✗',
  skipped: '—',
};

const BY_TEXT: Record<'circuit' | 'pre-check', string> = {
  circuit: '회로',
  'pre-check': '사전',
};

export function Checklist({
  descriptors,
  checks,
  shown = Number.MAX_SAFE_INTEGER,
}: {
  descriptors: readonly CheckDescriptor[];
  checks: Record<string, CheckResult> | null;
  /** 몇 줄까지 드러났는가. 판정은 이미 끝나 있고 순서만 만든다. */
  shown?: number;
}) {
  return (
    <ul className="checks">
      {descriptors.slice(0, shown).map((descriptor) => {
        const result = checks?.[descriptor.key] ?? { state: 'skipped' as const, by: null };
        return (
          <li key={descriptor.key} className={`check check--${result.state}`}>
            <span className="check__mark" aria-hidden="true">
              {MARK[result.state]}
            </span>
            <span className="check__label">{descriptor.label}</span>
            <span className="check__assert">{descriptor.assert}</span>
            <span className="check__by">
              {result.by === null ? '미평가' : BY_TEXT[result.by]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
