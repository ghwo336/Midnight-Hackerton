'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** 검사 한 줄이 드러나는 간격. 네 줄이 480ms 안에 끝난다. */
const STEP_MS = 120;

/**
 * 체크리스트 순차 노출.
 *
 * **판정은 이미 끝나 있다.** 백엔드 응답이 도착한 뒤에 이 훅이 돌고,
 * 화면에 나타나는 순서만 만든다. 심사를 늦추거나 가짜 단계를 끼워넣지 않는다.
 *
 * 순서에 의미가 있다: 회로가 assert를 평가한 순서대로 드러나므로, 어디서
 * 멈췄는지가 눈으로 따라진다. 앞 세 줄에 ✓가 찍히고 네 번째에서 ✗가 나는
 * 장면이 곧 "여기까지는 통과했는데 중복이었다"이다.
 */
export function useCheckReveal(total: number) {
  const [shown, setShown] = useState(total);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  useEffect(() => clear, [clear]);

  const play = useCallback(() => {
    clear();
    // 모션을 끄기로 한 사용자에게는 순차 노출도 하지 않는다.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setShown(total);
      return;
    }
    setShown(0);
    for (let i = 1; i <= total; i += 1) {
      timers.current.push(setTimeout(() => setShown(i), i * STEP_MS));
    }
  }, [clear, total]);

  /** 새로고침처럼 연출 없이 즉시 보여야 할 때. */
  const showAll = useCallback(() => {
    clear();
    setShown(total);
  }, [clear, total]);

  return { shown, play, showAll };
}
