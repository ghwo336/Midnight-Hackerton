'use client';

import { useEffect } from 'react';

export type FinancingStage =
  | 'witness' | 'proving' | 'submitting' | 'settled' | 'rejected';

export type OnceEvent =
  | { type: 'invoice.issued'; invoiceId: string }
  | {
      type: 'financing.stage';
      lender: string;
      stage: FinancingStage;
      at: string;
      elapsedMs: number;
      block?: number;
    }
  | {
      type: 'financing.settled';
      nullifier: string; lender: string; amount: string; txHash: string; block: number;
    }
  | {
      type: 'financing.rejected';
      reason: string;
      lender: string;
      circuitAssert?: string | null;
    };

/**
 * 3개 패널이 동시에 갱신돼야 데모가 산다 (SPEC §8.4).
 * 이벤트를 받으면 관련 쿼리를 무효화한다.
 */
export function useOnceEvents(url: string, onEvent: (event: OnceEvent) => void): void {
  useEffect(() => {
    const source = new EventSource(url);
    source.onmessage = (message: MessageEvent<string>) => {
      try {
        onEvent(JSON.parse(message.data) as OnceEvent);
      } catch {
        // 발표 중 이벤트 하나가 깨져도 화면이 멈추면 안 된다
      }
    };
    return () => source.close();
  }, [url, onEvent]);
}
