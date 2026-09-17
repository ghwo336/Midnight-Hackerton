'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { OnceEvent } from '@/shared/sse/use-once-events';

/**
 * 역할 화면 하나를 체인 변화에 붙인다.
 *
 * ── 왜 전부 SSE를 쓰지 않는가 ──────────────────────────────
 *
 * EventSource는 끊지 않고 붙들고 있는 연결이다. 화면마다 하나씩 열면
 * 발표 콘솔이 iframe 넷을 띄웠을 때 콘솔까지 다섯 개가 동시에 열린다.
 * 브라우저는 HTTP/1.1에서 origin당 동시 연결을 여섯 개로 막는다. 다섯을
 * 스트림이 영구 점유하면 남은 한 칸을 주기적 GET들이 계속 차지하고,
 * 대출 신청 POST가 브라우저 큐에서 나가지 못한 채 멈춘다. 서버 로그에
 * 요청이 아예 찍히지 않는 형태로 나타난다.
 *
 * 그래서 **단계 이벤트가 실제로 필요한 화면만** 스트림을 쓴다. 나머지는
 * 짧게 끝나는 폴링으로 갱신한다. 연결을 붙들지 않으므로 한도를 먹지 않는다.
 *
 *   always      단계 이벤트가 화면의 내용이다 (납품업체 증명 로그)
 *   standalone  혼자 열렸을 때만 스트림. iframe 안에서는 폴링
 *   never       폴링만
 */
const POLL_MS = 1200;

export type LiveMode = 'always' | 'standalone' | 'never';

/** iframe 안인가. 렌더가 아니라 구독 시점에 한 번만 본다. */
function insideFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // 교차 출처라 접근이 막혔다면 그 자체가 끼워져 있다는 뜻이다
    return true;
  }
}

export function useLive(
  mode: LiveMode = 'standalone',
  onEvent?: (event: OnceEvent) => void,
): void {
  const queryClient = useQueryClient();

  /*
   * 콜백을 ref에 담는 이유: 이걸 effect 의존성에 넣으면 화면 상태가
   * 바뀔 때마다 연결을 끊고 다시 연다. 신청 대상이 바뀔 때마다 재연결이
   * 일어나던 게 연결 고갈을 더 키웠다.
   */
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({
        // 체크리스트 라벨과 회로 표현식은 바뀌지 않는다. 다시 받지 않는다.
        predicate: (query) => query.queryKey[0] !== 'lenderChecks',
      });
    };

    const stream = mode === 'always' || (mode === 'standalone' && !insideFrame());

    if (!stream) {
      const timer = setInterval(refresh, POLL_MS);
      return () => clearInterval(timer);
    }

    const source = new EventSource(api.eventsUrl());
    source.onmessage = (message: MessageEvent<string>) => {
      try {
        handler.current?.(JSON.parse(message.data) as OnceEvent);
      } catch {
        // 발표 중 이벤트 하나가 깨져도 화면이 멈추면 안 된다
      }
      refresh();
    };
    return () => source.close();
  }, [mode, queryClient]);
}
