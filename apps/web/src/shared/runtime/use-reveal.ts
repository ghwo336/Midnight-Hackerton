'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { REVEAL, REVEAL_ALL, REVEAL_NONE, type Reveal } from './financing-runtime';

/**
 * 순차 노출 오케스트레이터.
 *
 * **중요: 데이터는 이미 확정돼 있다.** 백엔드 응답이 도착한 뒤에 이 훅이
 * 돌고, 화면에 나타나는 순서만 만든다. 요청을 늦추거나 가짜 단계를 끼워넣지
 * 않으며, 진행 단계에 찍히는 시간은 백엔드가 보고한 실측값 그대로다.
 *
 * 사람이 "로그 → 단계 → 도장 → 금액 → 원장"을 따라갈 수 있게 600ms 안에
 * 펼쳐 보여주는 것이 전부다.
 */
export function useReveal(totalLogLines: number) {
  const [reveal, setReveal] = useState<Reveal>(REVEAL_ALL);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  useEffect(() => clear, [clear]);

  /** 응답 도착 시점에 호출한다. 확정된 결과를 순서대로 드러낸다. */
  const play = useCallback(
    (logLines: number) => {
      clear();
      // 모션을 끄기로 한 사용자에게는 순차 노출도 하지 않는다.
      if (
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        setReveal(REVEAL_ALL);
        return;
      }

      setReveal(REVEAL_NONE);
      const push = (ms: number, next: (prev: Reveal) => Reveal) => {
        timers.current.push(setTimeout(() => setReveal(next), ms));
      };

      for (let i = 1; i <= logLines; i += 1) {
        push(i * REVEAL.logStep, (prev) => ({ ...prev, logCount: i }));
      }
      push(REVEAL.amountsAt, (prev) => ({ ...prev, amounts: true }));
      push(REVEAL.stagesAt, (prev) => ({ ...prev, stages: true }));
      push(REVEAL.stampAt, (prev) => ({ ...prev, stamp: true }));
      push(REVEAL.ledgerAt, (prev) => ({ ...prev, ledger: true }));
    },
    [clear],
  );

  /** 진행 중에는 아직 아무것도 드러내지 않는다. */
  const reset = useCallback(() => {
    clear();
    setReveal(REVEAL_NONE);
  }, [clear]);

  /** 새로고침·초기화처럼 연출 없이 즉시 보여야 할 때. */
  const showAll = useCallback(() => {
    clear();
    setReveal(REVEAL_ALL);
  }, [clear]);

  void totalLogLines;
  return { reveal, play, reset, showAll };
}

/**
 * 금액 카운트업.
 *
 * CSS만으로는 천 단위 구분(80,000,000)을 유지할 수 없다. CSS counter에
 * 자릿수 그룹핑이 없어서 80000000으로 나온다. DESIGN §3.1이 요구하는
 * 자릿수 정렬을 지키려면 값 보간이 필요하므로 rAF로 숫자만 보간하고
 * 표시는 Intl.NumberFormat에 맡긴다. 애니메이션 라이브러리는 쓰지 않는다.
 */
export function useCountUp(target: string, enabled: boolean, durationMs = 400): string {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const to = Number(target.replace(/[^0-9]/g, '') || '0');
    const from = Number(fromRef.current.replace(/[^0-9]/g, '') || '0');

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!enabled || reduce || from === to) {
      fromRef.current = target;
      setValue(target);
      return;
    }

    const startedAt = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - startedAt) / durationMs, 1);
      // ease-out: 끝에서 부드럽게 멈춘다
      const eased = 1 - (1 - t) ** 3;
      setValue(String(Math.round(from + (to - from) * eased)));
      if (t < 1) frame.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [target, enabled, durationMs]);

  return value;
}
