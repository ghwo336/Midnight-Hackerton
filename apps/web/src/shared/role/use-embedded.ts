'use client';

import { useEffect, useState } from 'react';

/**
 * 이 화면이 다른 화면 안에 끼워져 있는가.
 *
 * 발표 콘솔은 역할 화면들을 iframe으로 띄운다. 그 안에서 역할 전환 링크를
 * 보여주면 좁은 칸 안에서 다른 역할로 넘어가 버려 콘솔이 깨진다.
 * 역할 이름은 그대로 두고 링크만 감춘다.
 *
 * 렌더 중에 window를 읽지 않는다. 서버 렌더 결과와 달라져 하이드레이션이
 * 깨진다. effect에서 한 번 확인한다.
 */
export function useEmbedded(): boolean {
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    try {
      setEmbedded(window.self !== window.top);
    } catch {
      // 교차 출처라 접근이 막혔다면 그 자체가 끼워져 있다는 뜻이다
      setEmbedded(true);
    }
  }, []);
  return embedded;
}
