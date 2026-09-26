'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/shared/api/client';
import type { LenderId } from '@/shared/api/types';
import { judgeConcurrent } from '@/shared/runtime/concurrent-verdict';
import { ATTACK_IDS, type AttackId, type AttackStatus } from './attack-panel';

const IDLE_ATTACKS = Object.fromEntries(
  ATTACK_IDS.map((id) => [id, { kind: 'idle' } as AttackStatus]),
) as Record<AttackId, AttackStatus>;

/**
 * 시뮬레이터 공격 러너의 상태와 실행.
 *
 * 검증 도구(/devtools)와 발표 콘솔 하단 줄이 같이 쓴다. 두 곳이 따로
 * 구현하면 한쪽만 고쳐지고, 같은 버튼이 화면마다 다르게 판정한다.
 */
export function useAttackRunner() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [attacks, setAttacks] = useState<Record<AttackId, AttackStatus>>(IDLE_ATTACKS);

  /**
   * A5: 두 금융사에 같은 채권으로 동시에 신청한다.
   *
   * 대상은 **첫 미사용 채권**이다. 판정은 결과에서 읽는다. 미리 써 두지
   * 않는다 (judgeConcurrent).
   */
  const runConcurrent = useCallback(async () => {
    const list = await api.invoices();
    const target = list.find((invoice) => !invoice.used);
    if (!target) return;

    setBusy(true);
    setAttacks((prev) => ({ ...prev, A5: { kind: 'running' } }));
    try {
      const results = await Promise.allSettled(
        (['lender-a', 'lender-b'] as const).map((lender: LenderId) =>
          api.finance(target.invoiceId, lender, target.maxLoanAmount),
        ),
      );
      const settled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      const verdict = judgeConcurrent({
        settledCount: settled.length,
        rejectedCount: rejected.length,
        rejectionCode:
          rejected
            .map((r) => (r.reason instanceof ApiError ? r.reason.code : 'UNKNOWN'))
            .at(0) ?? null,
        amountPerLoan: target.maxLoanAmount,
      });
      setAttacks((prev) => ({
        ...prev,
        A5: {
          kind: 'done',
          outcome: {
            id: 'A5',
            title: '두 금융사 동시 신청',
            expected: '하나만 확정, 나머지 자금 보존',
            ...verdict,
          },
        },
      }));
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries();
    }
  }, [queryClient]);

  const run = useCallback(
    async (id: AttackId) => {
      if (id === 'A5') {
        await runConcurrent();
        return;
      }
      setBusy(true);
      setAttacks((prev) => ({ ...prev, [id]: { kind: 'running' } }));
      try {
        const outcome = await api.attack(id);
        setAttacks((prev) => ({ ...prev, [id]: { kind: 'done', outcome } }));
      } catch {
        setAttacks((prev) => ({ ...prev, [id]: { kind: 'idle' } }));
      } finally {
        setBusy(false);
        void queryClient.invalidateQueries();
      }
    },
    [runConcurrent, queryClient],
  );

  const reset = useCallback(async () => {
    setBusy(true);
    try {
      await api.reset();
      setAttacks(IDLE_ATTACKS);
    } catch {
      // 실패해도 화면은 유지한다. 무엇이 안 됐는지는 값이 그대로인 것으로 보인다.
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries();
    }
  }, [queryClient]);

  return { attacks, busy, run, reset };
}
