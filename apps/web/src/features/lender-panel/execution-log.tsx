'use client';

import { useEffect, useRef } from 'react';
import type { LogLine } from '@/features/demo-console/lender-runtime';

/**
 * 실행 로그.
 *
 * 화면에서 모노스페이스를 쓰는 유일한 영역이다. DESIGN §3.1이 금지한 것은
 * "작은 데이터 라벨에 mono를 쓰는 것"이고, 로그는 줄 단위로 읽히는
 * 터미널 출력이라 예외로 둔다. 화면 전체를 터미널 테마로 바꾸지 않는다.
 *
 * 커서 깜빡임·타이핑 효과는 넣지 않는다. 줄이 그냥 추가된다.
 */
export function ExecutionLog({ lines }: { lines: readonly LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines.length]);

  return (
    <div className="log" ref={ref}>
      {lines.length === 0 ? (
        <div className="log__line log__line--empty">—</div>
      ) : (
        lines.map((line, index) => (
          <div
            key={`${line.at}-${index}`}
            className={`log__line ${line.tone === 'seal' ? 'log__line--seal' : ''}`}
          >
            <span className="log__at">{line.at}</span>
            <span>{line.text}</span>
          </div>
        ))
      )}
    </div>
  );
}
