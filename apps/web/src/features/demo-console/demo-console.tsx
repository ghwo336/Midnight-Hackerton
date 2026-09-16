'use client';

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/shared/api/client';
import type { AttackOutcome, LenderId } from '@/shared/api/types';
import { useOnceEvents } from '@/shared/sse/use-once-events';
import { LedgerTable } from '@/entities/loan/ledger-table';
import { SupplierPanel } from '@/features/supplier-panel/supplier-panel';
import { LenderPanel, type LenderOutcome } from '@/features/lender-panel/lender-panel';
import { AttackPanel } from '@/features/attack-panel/attack-panel';

const IDLE: LenderOutcome = { state: 'idle', amount: '0', txHash: null, reason: null };

/**
 * 데모 콘솔 — 발표의 얼굴 (SPEC §9.3, DESIGN §4).
 *
 * 3분할 고정. 공개 원장은 화면 하단에 항상 보인다. 접거나 탭으로 숨기지 않는다.
 * 도메인 로직 없음: nullifier 계산도 한도 검증도 하지 않고 백엔드 응답을
 * 표시만 한다 (SPEC §9.2).
 */
export function DemoConsole() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<LenderId, LenderOutcome>>({
    'lender-a': IDLE,
    'lender-b': IDLE,
  });
  const [runningAttack, setRunningAttack] = useState<string | null>(null);
  const [attackResult, setAttackResult] = useState<AttackOutcome | null>(null);

  const invoices = useQuery({ queryKey: ['invoices'], queryFn: api.invoices });
  const loans = useQuery({ queryKey: ['loans'], queryFn: api.loans });
  const lenderA = useQuery({ queryKey: ['lender', 'lender-a'], queryFn: () => api.lender('lender-a') });
  const lenderB = useQuery({ queryKey: ['lender', 'lender-b'], queryFn: () => api.lender('lender-b') });

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['loans'] });
    void queryClient.invalidateQueries({ queryKey: ['lender'] });
  }, [queryClient]);

  // SSE 이벤트를 받으면 관련 쿼리를 무효화한다 (SPEC §9.2)
  useOnceEvents(api.eventsUrl(), refreshAll);

  const request = useCallback(
    async (lender: LenderId) => {
      if (!selectedId) return;
      const invoice = invoices.data?.find((item) => item.invoiceId === selectedId);
      if (!invoice) return;

      setBusy(true);
      setOutcomes((prev) => ({
        ...prev,
        [lender]: { state: 'pending', amount: '0', txHash: null, reason: null },
      }));

      try {
        const settled = await api.finance(selectedId, lender, invoice.maxLoanAmount);
        setOutcomes((prev) => ({
          ...prev,
          [lender]: {
            state: 'settled',
            amount: settled.amount,
            txHash: settled.txHash,
            reason: null,
          },
        }));
      } catch (error: unknown) {
        // 거부 시 금액을 0으로 남긴다. 자금이 나가지 않았다는 게 주장이다.
        setOutcomes((prev) => ({
          ...prev,
          [lender]: {
            state: 'rejected',
            amount: '0',
            txHash: null,
            reason: error instanceof ApiError ? error.code : 'UNKNOWN',
          },
        }));
      } finally {
        setBusy(false);
        refreshAll();
      }
    },
    [selectedId, invoices.data, refreshAll],
  );

  const runAttack = useCallback(
    async (id: string) => {
      setRunningAttack(id);
      try {
        setAttackResult(await api.attack(id));
      } catch {
        setAttackResult(null);
      } finally {
        setRunningAttack(null);
        refreshAll();
      }
    },
    [refreshAll],
  );

  const reset = useCallback(async () => {
    setRunningAttack('reset');
    try {
      await api.reset();
      setOutcomes({ 'lender-a': IDLE, 'lender-b': IDLE });
      setAttackResult(null);
      setSelectedId(null);
    } catch {
      // 발표 중 리셋이 실패해도 화면은 유지한다
    } finally {
      setRunningAttack(null);
      refreshAll();
    }
  }, [refreshAll]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar__name">ONCE Finance</span>
        <span className="topbar__env">연결됨 · 로컬 회로</span>
      </header>

      <div className="columns">
        <SupplierPanel
          invoices={invoices.data ?? []}
          selectedId={selectedId}
          busy={busy}
          onSelect={setSelectedId}
          onRequest={request}
        />
        <LenderPanel lender={lenderA.data ?? null} role="lender-a" outcome={outcomes['lender-a']} />
        <LenderPanel lender={lenderB.data ?? null} role="lender-b" outcome={outcomes['lender-b']} />
      </div>

      <section className="section">
        <header className="section__head">
          <span>공개 원장</span>
          <span className="panel__role">이 화면에 채권 내용은 없다</span>
        </header>
        <div className="section__body">
          <LedgerTable loans={loans.data ?? []} />
        </div>
      </section>

      <AttackPanel
        running={runningAttack}
        result={attackResult}
        onRun={runAttack}
        onReset={reset}
      />
    </div>
  );
}
