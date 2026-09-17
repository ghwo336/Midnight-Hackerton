'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { useOnceEvents, type OnceEvent } from '@/shared/sse/use-once-events';

/**
 * 역할 화면 하나를 체인 이벤트에 붙인다.
 *
 * 화면이 네 개로 갈라졌으므로 서로를 직접 갱신할 수 없다. 대신 각자
 * 같은 이벤트 스트림을 듣는다. 납품업체가 신청하면 금융사 두 화면이
 * 각각 반응한다. 발표 콘솔이 iframe으로 띄워도 같은 방식으로 동작한다.
 *
 * 이게 콘솔이 패널을 직접 조종하던 구조보다 정직하다. 세 앱이 정말로
 * 따로 돌고 있고, 공유하는 것은 공개 이벤트뿐이다.
 */
export function useLive(onEvent?: (event: OnceEvent) => void): void {
  const queryClient = useQueryClient();

  const handle = useCallback(
    (event: OnceEvent) => {
      onEvent?.(event);
      void queryClient.invalidateQueries();
    },
    [queryClient, onEvent],
  );

  useOnceEvents(api.eventsUrl(), handle);
}
