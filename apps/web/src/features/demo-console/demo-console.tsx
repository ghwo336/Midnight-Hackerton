'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/shared/api/client';
import type { LenderId } from '@/shared/api/types';
import { useOnceEvents, type OnceEvent } from '@/shared/sse/use-once-events';
import { EMPTY, shortHash } from '@/shared/ui/format';
import { LedgerTable } from '@/entities/loan/ledger-table';
import { SupplierPanel } from '@/features/supplier-panel/supplier-panel';
import { LenderPanel } from '@/features/lender-panel/lender-panel';
import {
  AttackPanel, ATTACK_IDS, type AttackId, type AttackStatus,
} from '@/features/attack-panel/attack-panel';
import {
  INITIAL_RUNTIMES, IDLE_RUNTIME, REVEAL, applyStage, beginRequest,
  type LenderRuntimes,
} from './lender-runtime';
import { useReveal } from './use-reveal';
import type { VaultContrast } from '@/features/lender-panel/lender-panel';

const LABEL: Record<LenderId, string> = { 'lender-a': '금융사 A', 'lender-b': '금융사 B' };

const IDLE_ATTACKS = Object.fromEntries(
  ATTACK_IDS.map((id) => [id, { kind: 'idle' } as AttackStatus]),
) as Record<AttackId, AttackStatus>;

/**
 * 데모 콘솔 — 발표의 얼굴 (SPEC §9.3, DESIGN §4).
 *
 * 도메인 로직 없음: nullifier 계산도 한도 검증도 하지 않고 백엔드 응답을
 * 표시만 한다. 금융사 패널의 도장은 **공개 원장에서 파생**되므로
 * 새로고침해도 상태가 유지된다.
 */
export function DemoConsole() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runtimes, setRuntimes] = useState<LenderRuntimes>(INITIAL_RUNTIMES);
  const [attacks, setAttacks] = useState<Record<AttackId, AttackStatus>>(IDLE_ATTACKS);
  const [tick, setTick] = useState(0);
  /** A5 진행 중에는 두 금융사 패널만 남기고 나머지를 어둡게 한다. */
  const [climax, setClimax] = useState(false);
  const [climaxDone, setClimaxDone] = useState(false);
  const [vaultBefore, setVaultBefore] = useState<Record<LenderId, string> | null>(null);
  const revealA = useReveal(0);
  const revealB = useReveal(0);

  const chain = useQuery({ queryKey: ['chain'], queryFn: api.chain, refetchInterval: 4000 });
  const invoices = useQuery({ queryKey: ['invoices'], queryFn: api.invoices });
  const loans = useQuery({ queryKey: ['loans'], queryFn: api.loans });
  const lenderA = useQuery({ queryKey: ['lender', 'lender-a'], queryFn: () => api.lender('lender-a') });
  const lenderB = useQuery({ queryKey: ['lender', 'lender-b'], queryFn: () => api.lender('lender-b') });

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['loans'] });
    void queryClient.invalidateQueries({ queryKey: ['lender'] });
    void queryClient.invalidateQueries({ queryKey: ['chain'] });
  }, [queryClient]);

  // 진행 중일 때만 경과 시간을 갱신한다. 애니메이션이 아니라 실측값 표시다.
  const anyInFlight = (['lender-a', 'lender-b'] as const).some(
    (id) => runtimes[id].phase !== 'idle' && runtimes[id].phase !== 'settled' && runtimes[id].phase !== 'rejected',
  );
  useEffect(() => {
    if (!anyInFlight) return;
    const timer = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(timer);
  }, [anyInFlight]);

  const onEvent = useCallback(
    (event: OnceEvent) => {
      if (event.type === 'financing.stage') {
        const lender = event.lender as LenderId;
        setRuntimes((prev) => ({ ...prev, [lender]: applyStage(prev[lender], event) }));
      }
      // financing.rejected는 로그를 추가하지 않는다. financing.stage(rejected)가
      // 이미 회로 근거와 함께 한 번 추가하므로, 여기서 또 넣으면 두 번 찍힌다.
      refreshAll();
    },
    [refreshAll],
  );
  useOnceEvents(api.eventsUrl(), onEvent);

  const eventsRef = useRef(onEvent);
  eventsRef.current = onEvent;

  const request = useCallback(
    async (lender: LenderId, invoiceId: string, amount: string) => {
      const rev = lender === 'lender-a' ? revealA : revealB;
      rev.reset();
      setRuntimes((prev) => ({ ...prev, [lender]: beginRequest(new Date().toISOString()) }));
      try {
        await api.finance(invoiceId, lender, amount);
      } catch (error: unknown) {
        const code = error instanceof ApiError ? error.code : 'UNKNOWN';
        const assertExpr = error instanceof ApiError ? error.circuitAssert : null;
        setRuntimes((prev) => ({
          ...prev,
          [lender]: { ...prev[lender], phase: 'rejected', reason: code, circuitAssert: assertExpr },
        }));
      }
      // 응답이 도착한 뒤에 순서를 만든다. 데이터는 이미 확정된 값이다.
      setRuntimes((prev) => {
        rev.play(prev[lender].log.length);
        return prev;
      });
    },
    [revealA, revealB],
  );

  const requestSelected = useCallback(
    async (lender: LenderId) => {
      // 선택이 없으면 첫 미사용 채권으로 진행한다. 죽은 클릭을 만들지 않는다.
      const invoice =
        invoices.data?.find((item) => item.invoiceId === selectedId) ??
        invoices.data?.find((item) => !item.used) ??
        invoices.data?.[0];
      if (!invoice) return;
      if (invoice.invoiceId !== selectedId) setSelectedId(invoice.invoiceId);
      setBusy(true);
      try {
        await request(lender, invoice.invoiceId, invoice.maxLoanAmount);
      } finally {
        setBusy(false);
        refreshAll();
      }
    },
    [invoices.data, selectedId, request, refreshAll],
  );

  /**
   * A5 — 데모의 클라이맥스.
   *
   * 서버가 대신 돌려주는 게 아니라 **화면에서 두 요청을 동시에 쏜다.**
   * 두 패널의 증명 카운터가 나란히 돌고, 한쪽에 파란 도장, 다른 쪽에
   * 빨간 도장이 찍히며, 예치 잔액이 한쪽만 줄어든 게 나란히 보인다.
   */
  const runConcurrent = useCallback(async () => {
    const target = invoices.data?.find((item) => !item.used);
    if (!target) return;
    setSelectedId(target.invoiceId);
    setBusy(true);
    setClimax(true);
    setClimaxDone(false);
    setVaultBefore({
      'lender-a': lenderA.data?.vault ?? '0',
      'lender-b': lenderB.data?.vault ?? '0',
    });
    setAttacks((prev) => ({ ...prev, A5: { kind: 'running' } }));
    try {
      await Promise.allSettled([
        request('lender-a', target.invoiceId, target.maxLoanAmount),
        request('lender-b', target.invoiceId, target.maxLoanAmount),
      ]);
      // 두 도장이 같은 프레임에 찍히도록 노출을 한 번에 재생한다
      revealA.play(6);
      revealB.play(6);
      setTimeout(() => {
        setClimax(false);
        setClimaxDone(true);
      }, REVEAL.total);
      setAttacks((prev) => ({
        ...prev,
        A5: {
          kind: 'done',
          outcome: {
            id: 'A5', title: '두 금융사 동시 신청',
            expected: '하나만 확정, 나머지 자금 보존',
            blocked: true, code: 'NULLIFIER_ALREADY_USED',
            fundsMoved: target.maxLoanAmount, note: '',
          },
        },
      }));
    } finally {
      setBusy(false);
      refreshAll();
    }
  }, [invoices.data, request, refreshAll, lenderA.data, lenderB.data, revealA, revealB]);

  const runAttack = useCallback(
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
        refreshAll();
      }
    },
    [runConcurrent, refreshAll],
  );

  const reset = useCallback(async () => {
    setBusy(true);
    try {
      await api.reset();
      setRuntimes(INITIAL_RUNTIMES);
      setAttacks(IDLE_ATTACKS);
      setSelectedId(null);
      setClimax(false);
      setClimaxDone(false);
      setVaultBefore(null);
      revealA.showAll();
      revealB.showAll();
    } catch {
      // 발표 중 리셋이 실패해도 화면은 유지한다
    } finally {
      setBusy(false);
      refreshAll();
    }
  }, [refreshAll, revealA, revealB]);

  const loanFor = (lender: LenderId) =>
    loans.data?.find((loan) => loan.lender === lender) ?? null;

  const elapsedFor = (lender: LenderId) => {
    const started = runtimes[lender].startedAt;
    return started === null ? null : Date.now() - started;
  };
  void tick; // 경과 시간 갱신 트리거

  const status = chain.data;

  /** A5 직후 두 패널의 잔액 변화를 나란히 대비시킨다. */
  const contrastFor = (id: LenderId): VaultContrast | null => {
    if (!climaxDone || !vaultBefore) return null;
    const before = BigInt(vaultBefore[id] ?? '0');
    const after = BigInt((id === 'lender-a' ? lenderA.data : lenderB.data)?.vault ?? '0');
    const diff = before - after;
    return diff > 0n
      ? { kind: 'spent', delta: `−${new Intl.NumberFormat('ko-KR').format(diff)}` }
      : { kind: 'unchanged', delta: '변동 없음' };
  };

  return (
    <div className={`app ${climax ? 'app--climax' : ''}`}>
      <div className="shell">
        <header className="topbar">
          <span className="topbar__title">
            <span className="topbar__name">ONCE Finance</span>
            <span className="topbar__tagline">
              같은 채권으로 두 번 대출받을 수 없다 — 장부를 공유하지 않고
            </span>
          </span>
          <span className="topbar__status">
            <span className="topbar__item">
              체인 <b>{status?.network ?? EMPTY}</b>
            </span>
            <span className="topbar__item">
              블록 <b className="num">{status?.blockHeight ?? EMPTY}</b>
            </span>
            <span className="topbar__item">
              컨트랙트{' '}
              <b className="num">
                {status ? shortHash(`0x${status.contractAddress}`) : EMPTY}
              </b>
            </span>
            <span className="topbar__item">
              노드 <b>{status?.connected ? '연결됨' : '끊김'}</b>
            </span>
          </span>
        </header>

        <div className="columns">
          <SupplierPanel
            dimmed={climax}
            invoices={invoices.data ?? []}
            selectedId={selectedId}
            busy={busy}
            onSelect={setSelectedId}
            onRequest={requestSelected}
          />
          {(['lender-a', 'lender-b'] as const).map((id) => (
            <LenderPanel
              key={id}
              role={id}
              label={LABEL[id]}
              lender={(id === 'lender-a' ? lenderA.data : lenderB.data) ?? null}
              loan={loanFor(id)}
              runtime={runtimes[id] ?? IDLE_RUNTIME}
              elapsedMs={elapsedFor(id)}
              reveal={(id === 'lender-a' ? revealA : revealB).reveal}
              vaultContrast={contrastFor(id)}
              dimmed={false}
            />
          ))}
        </div>

        <section className={`section ${climax ? 'section--dimmed' : ''}`}>
          <header className="section__head">
            <span>공개 원장</span>
            <span className="panel__role">이 화면에 채권 내용은 없다</span>
          </header>
          <div className="section__body">
            <LedgerTable
              loans={loans.data ?? []}
              revealed={revealA.reveal.ledger && revealB.reveal.ledger}
              explorerBase={status?.network === 'local-circuit' ? null : status?.network ?? null}
            />
          </div>
        </section>

        {climaxDone ? (
          <p className="climax-note">한 건만 나갔다. B는 A의 장부를 보지 않았다.</p>
        ) : null}

        <div className={climax ? 'section--dimmed' : ''}>
          <AttackPanel statuses={attacks} busy={busy} onRun={runAttack} onReset={reset} />
        </div>
      </div>
    </div>
  );
}
