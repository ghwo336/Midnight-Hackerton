'use client';

import { useCallback, useState } from 'react';
import type { WalletSession } from '@/shared/wallet/session';
import { ApiError, api } from '@/shared/api/client';
import type { LenderId, SupplierInvoice } from '@/shared/api/types';
import { EMPTY, formatAmount, shortHash } from '@/shared/ui/format';
import {
  VERDICT_LABEL, judgeA5, judgeA6,
  type AttackResult, type AttemptResult,
} from '@/shared/runtime/onchain-verdict';
import { TX_PHASE_LABEL, type TxPhase } from '@/shared/runtime/tx-phase';
import {
  judgeStaleRejection, runFinancingAttempt, setupSettledOnLedger, type PreparedSubmission,
} from '@/shared/runtime/financing-attempt';
import { isSubmittedContract } from '@/shared/wallet/demo-fixtures';

/**
 * 실제 체인에서 A5·A6 을 재현한다.
 *
 * 시뮬레이터 러너는 서버가 서명했다. 실제 네트워크에서는 개인키가 지갑에만
 * 있으므로 여기서 지갑으로 서명한다. **트랜잭션마다 지갑 승인 창이 뜬다**
 * — A5 는 두 번, A6 은 두 번이다.
 *
 * 한 건에 30~45초가 걸린다. 그 대부분은 승인과 블록 확정이고, 증명은 1초
 * 남짓이다. 어느 구간인지 화면에 계속 적는다.
 *
 * 쓰는 채권은 **되돌릴 수 없다.** 실행하면 그 채권의 중복 확인값이 원장에
 * 영구히 등록되고 다시 담보로 쓸 수 없다. 그게 이 제품이 주장하는 바로
 * 그 성질이라 되돌리는 경로를 두지 않는다.
 */
type RunId = 'A5' | 'A6';

/** 서버가 주는 신청 재료. */
type Plan = Awaited<ReturnType<typeof api.prepareFinancing>>;

/**
 * A6 에서 금융사 B 의 지연 제출을 다시 할 수 있게 들고 있는 것.
 *
 * 셋업(금융사 A)은 확정돼 채권을 이미 썼는데 B 의 제출이 대납 서버 문제로
 * 끝내 실패하면, 처음부터 다시 하는 것은 채권을 하나 더 쓰는 일이다. 미리
 * 만든 증명은 그대로 쓸 수 있다 — 잔액 조정만 다시 하면 된다.
 */
interface A6Retry {
  /**
   * 시험 대상 채권. 다시 낼 때 free[0] 로 다시 고르면 안 된다 — 셋업이 확정된
   * 뒤라 이 채권은 이미 '사용됨' 이고 free[0] 은 다른 채권이다.
   */
  readonly target: SupplierInvoice;
  readonly setup: AttemptResult;
  readonly plan: Plan;
  readonly submit: () => Promise<{ txHash: string; block: number }>;
}

/** 셋업 확정 뒤 B 를 내기 전 기다리는 시간. 대납 서버가 앞 건을 정리할 틈이다. */
const A6_SETTLE_SECONDS = 15;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface RunState {
  readonly running: RunId | null;
  readonly phase: string | null;
  readonly results: Partial<Record<RunId, AttackResult>>;
  readonly error: string | null;
}

const INITIAL: RunState = { running: null, phase: null, results: {}, error: null };

export function OnChainAttacks({
  wallet,
  contractAddress,
  invoices,
  onDone,
}: {
  wallet: WalletSession | null;
  contractAddress: string | null;
  invoices: readonly SupplierInvoice[];
  onDone: () => void;
}) {
  const [state, setState] = useState<RunState>(INITIAL);
  const [a6Retry, setA6Retry] = useState<A6Retry | null>(null);

  const free = invoices.filter((invoice) => !invoice.used);
  const ready = wallet !== null && contractAddress !== null;

  /*
   * 지금 겨누는 곳이 제출한 컨트랙트인가.
   *
   * 이 버튼은 서버가 가리키는 컨트랙트로 간다. pnpm dev:preprod 면 원본,
   * pnpm dev:rehearsal 이면 연습용이다. 화면만 봐서는 구분되지 않았고,
   * 연습용을 올려 놓고도 원본 채권을 쓸 뻔했다.
   *
   * 원본에서의 실행을 막지는 않는다. 본 공연도 결국 이 버튼으로 한다.
   * 대신 누르기 전에 한 번 더 묻는다 — 되돌릴 수 없는 일이다.
   */
  const onSubmitted = isSubmittedContract(contractAddress);
  const confirmTarget = (id: RunId): boolean => {
    if (!onSubmitted) return true;
    return window.confirm(
      `원본(제출) 컨트랙트입니다. ${id} 를 실행하면 채권이 영구히 소모되고 되돌릴 수 없습니다 ` +
        `(남은 미사용 채권 ${free.length}건). 연습용에서 먼저 해 보려면 취소하고 ` +
        'pnpm dev:rehearsal 로 서버를 다시 띄우세요. 계속할까요?',
    );
  };

  const setPhase = useCallback((lender: string, phase: TxPhase) => {
    setState((prev) => ({ ...prev, phase: `${lender} · ${TX_PHASE_LABEL[phase]}` }));
  }, []);

  /**
   * 신청 한 건을 끝까지 밀어붙이고 결말을 돌려준다. 던지지 않는다.
   *
   * 여기서 예외를 던지면 A5 의 두 갈래 중 하나가 사라져 판정할 수 없다.
   * 실패도 결과의 일부다. 흐름 자체는 runFinancingAttempt 에 있고 테스트가
   * 지킨다 — 이 컴포넌트 안에 있을 때 A6 가 제출조차 안 되는 버그가 숨어 있었다.
   */
  const attempt = useCallback(
    async (
      invoice: SupplierInvoice,
      lender: LenderId,
      /** 미리 준비한 신청. 있으면 서버 사전 검사를 다시 부르지 않는다 (A6). */
      prepared?: PreparedSubmission<Plan>,
    ): Promise<AttemptResult> => {
      if (!wallet || !contractAddress) {
        const now = Date.now();
        return {
          lender, settled: false, code: null, detail: '지갑이 연결되지 않았다',
          txHash: null, block: null, ms: 0, startedAt: now, endedAt: now,
        };
      }
      const calls = await import('@/shared/wallet/circuit-calls');
      return runFinancingAttempt<Plan>(
        lender,
        {
          now: () => Date.now(),
          prepare: () => api.prepareFinancing(invoice.invoiceId, lender, invoice.maxLoanAmount, []),
          submit: (plan) =>
            calls.financeOnChain(wallet, contractAddress, plan, (phase) => setPhase(lender, phase)),
          confirm: async (plan, r) => {
            await api.confirmFinancing({
              applicationId: plan.applicationId,
              invoiceId: invoice.invoiceId,
              lenderId: lender,
              amount: plan.amount,
              nullifier: plan.nullifier,
              receivedAt: plan.receivedAt,
              elapsedMs: r.elapsedMs,
              disclose: [],
              outcome: r.outcome,
              txHash: r.txHash,
              block: r.block,
              reason: r.reason,
            });
          },
          classify: calls.classifyCircuitError,
          chainStatusOf: calls.chainStatusOf,
          describe: calls.describe,
          describePrepareError: (error) => (error instanceof ApiError ? error.code : String(error)),
        },
        prepared,
      );
    },
    [wallet, contractAddress, setPhase],
  );

  /**
   * 지연 제출 결과를 증거로 판정한다.
   *
   * 노드의 거부에는 회로 assert 문구가 없어서 분류기가 사유를 모른다. 체인이
   * FailEntirely 로 기록했는지와 원장을 보고 판정한다(judgeStaleRejection).
   * 증거가 없으면 사유를 비워 둔다 — 판정 불가.
   */
  const judgeDelayed = useCallback(
    async (setup: AttemptResult, delayed: AttemptResult, nullifier: string): Promise<AttemptResult> => {
      if (!setup.settled || delayed.settled || delayed.code !== null) return delayed;
      const loans = await api.loans().catch(() => null);
      const evidence = judgeStaleRejection({
        chainStatus: delayed.chainStatus ?? null,
        loansForNullifier: (loans ?? [])
          .filter((loan) => loan.nullifier.toLowerCase() === nullifier.toLowerCase())
          .map((loan) => ({ lender: loan.lender })),
        setupLender: setup.lender,
      });
      return {
        ...delayed,
        code: loans === null ? null : evidence.code,
        detail: [
          delayed.detail,
          loans === null ? '원장을 읽지 못해 체인 거부를 확인하지 못했다' : evidence.note,
        ].filter(Boolean).join(' — '),
      };
    },
    [],
  );

  /**
   * A5: 두 금융사가 같은 채권으로 동시에 신청한다. 하나만 확정돼야 한다.
   *
   * 두 신청을 정말 병렬로 띄운다. 둘 다 처음부터 — 서버 사전 검사, 회로 실행,
   * 증명, 제출 — 동시에 돈다. 두 회로가 거의 같은 순간에 원장을 읽으므로 둘 다
   * "nullifier 미사용" 이라고 적힌 채 체인으로 가고, 체인이 순서를 정해 하나만
   * 통과시켜야 한다.
   *
   * 한동안 두 증명을 먼저 만들고 함께 내는 방식이었다. 대납 서버가 트랜잭션을
   * 한 번에 하나씩만 받아서 두 번째를 안전하게 재시도하려던 것이다. 지갑에 자기
   * DUST 가 생기면 두 번째는 대납 거절 창에서 "Pay with My Dust" 로 바로 나간다.
   * 그래서 원래 방식으로 되돌렸다. **재시도는 없다** — 두 번째를 처음부터 다시
   * 돌리면 이긴 쪽이 확정된 뒤의 원장으로 회로를 돌리게 되고, 내 브라우저가
   * 먼저 막아 체인은 시험하지 않은 채 '통과' 가 켜진다.
   *
   * 진 쪽의 거부에는 회로 assert 문구가 없다. 판정은 A6 와 같은 증거로 한다 —
   * 체인이 FailFallible 로 기록했고 원장의 대출이 이긴 쪽 하나뿐.
   */
  const runA5 = useCallback(async () => {
    const target = free[0];
    if (!target) return;
    if (!confirmTarget('A5')) return;
    setA6Retry(null);
    setState({ running: 'A5', phase: null, results: {}, error: null });
    try {
      const raw = await Promise.all([
        attempt(target, 'lender-a'),
        attempt(target, 'lender-b'),
      ]);

      const winners = raw.filter((a) => a.settled);
      const judgeLoser = async (winner: AttemptResult, loser: AttemptResult) => {
        /*
         * 진 쪽을 내 브라우저의 회로가 막았다면(체인 상태 없음 + 회로 사유)
         * 그 회로는 이긴 쪽이 확정된 뒤의 원장을 읽은 것이다. 체인의 경합을
         * 시험한 게 아니므로 통과 근거로 쓰지 않는다.
         */
        if (!loser.chainStatus && loser.code === 'NULLIFIER_ALREADY_USED') {
          return {
            ...loser, code: null,
            detail:
              '체인에 닿기 전에 브라우저의 회로가 막았다 — 이긴 쪽이 확정된 뒤에 회로를 ' +
              '돌렸다. 체인의 경합을 시험한 게 아니다',
          };
        }
        const nf = loser.nullifier ?? winner.nullifier;
        return nf ? judgeDelayed(winner, loser, nf) : loser;
      };
      const attempts = winners.length === 1
        ? await Promise.all(raw.map((a) => (a.settled ? a : judgeLoser(winners[0]!, a))))
        : raw;

      setState((prev) => ({
        ...prev, running: null, phase: null,
        results: { ...prev.results, A5: judgeA5(attempts) },
      }));
    } catch (error: unknown) {
      setState((prev) => ({
        ...prev, running: null, phase: null,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      onDone();
    }
    // confirmTarget 이 겨누는 곳을 판단하므로 주소가 바뀌면 새로 만든다.
  }, [free, attempt, onDone, contractAddress, judgeDelayed]);

  /** B 를 내고 판정까지. 체인이 판단하지 못한 실패면 다시 제출할 수 있게 남긴다. */
  const submitDelayed = useCallback(
    async (retry: A6Retry) => {
      setState((prev) => ({ ...prev, phase: '금융사 B · 미리 만든 증명 제출' }));
      const raw = await attempt(retry.target, 'lender-b', { plan: retry.plan, submit: retry.submit });
      const delayed = await judgeDelayed(retry.setup, raw, retry.plan.nullifier);

      /*
       * 체인이 판단하지 못한 채 끝났으면(대납 거절·타임아웃 등) 증명을
       * 들고 있는다. 체인이 판단했다면(확정이든 거부든) 결과가 난 것이라
       * 다시 낼 이유가 없다.
       */
      const chainDecided = delayed.settled || delayed.code !== null || Boolean(delayed.chainStatus);
      setA6Retry(chainDecided ? null : retry);

      setState((prev) => ({
        ...prev, running: null, phase: null,
        results: { ...prev.results, A6: judgeA6(retry.setup, delayed) },
      }));
    },
    [attempt, judgeDelayed],
  );

  /**
   * A6: 비어 있을 때 **증명까지 만들어 두고**, 채워진 뒤에 낸다.
   *
   * 금융사 B 의 신청을 먼저 준비한다 — 원장을 읽어 회로를 실행하고 증명까지
   * 만든다. 그 시점에 중복 확인값은 비어 있다. 그다음 금융사 A 가 정상 대출을
   * 확정시키고, 들고 있던 B 의 트랜잭션을 그대로 낸다. 체인이 실행 시점의
   * 원장으로 다시 보고 막아야 한다.
   *
   * **A 가 확정되지 않으면 B 를 내지 않는다.** nullifier 가 비어 있으니 체인이
   * B 를 정상 대출로 받아 준다 — 시험은 못 하고 채권만 쓴다. 연습용에서 실제로
   * 그렇게 하나를 잃었다. 확정 여부는 지갑 오류가 아니라 원장으로 본다. 지갑이
   * "Wallet UI disconnected" 를 냈는데 대출은 블록에 들어가 있던 적이 있다.
   */
  const runA6 = useCallback(async () => {
    const target = free[0];
    if (!target || !wallet || !contractAddress) return;
    if (!confirmTarget('A6')) return;
    setA6Retry(null);
    setState({ running: 'A6', phase: null, results: {}, error: null });
    try {
      const { prepareStaleFinanceCall } = await import('@/shared/wallet/circuit-calls');

      setState((prev) => ({ ...prev, phase: '금융사 B · 미사용 시점에 회로 실행과 증명' }));
      const plan = await api.prepareFinancing(
        target.invoiceId, 'lender-b', target.maxLoanAmount, [],
      );
      const held = await prepareStaleFinanceCall(wallet, contractAddress, plan, (phase) =>
        setPhase('lender-b(준비)', phase),
      );

      setState((prev) => ({ ...prev, phase: '금융사 A · 정상 대출 실행' }));
      let setup = await attempt(target, 'lender-a');

      if (!setup.settled) {
        setState((prev) => ({
          ...prev, phase: '금융사 A · 지갑이 실패를 보고했다 — 원장에 확정됐는지 확인 중',
        }));
        let onLedger = false;
        for (let i = 0; i < 6 && !onLedger; i += 1) {
          const loans = await api.loans().catch(() => null);
          onLedger = loans !== null && setupSettledOnLedger({
            loans, nullifier: plan.nullifier, setupLender: 'lender-a',
          });
          if (!onLedger) await sleep(5_000);
        }
        if (onLedger) {
          setup = {
            ...setup, settled: true, code: null,
            detail: `지갑은 실패를 보고했지만 원장에 확정돼 있다 (${setup.detail ?? '사유 없음'})`,
          };
        } else {
          const skipped: AttemptResult = {
            lender: 'lender-b', settled: false, code: null,
            detail: '셋업이 확정되지 않아 제출하지 않았다 — 냈다면 정상 대출로 받아져 채권만 썼다',
            txHash: null, block: null, ms: 0, startedAt: Date.now(), endedAt: Date.now(),
          };
          setState((prev) => ({
            ...prev, running: null, phase: null,
            results: { ...prev.results, A6: judgeA6(setup, skipped) },
          }));
          return;
        }
      }

      for (let left = A6_SETTLE_SECONDS; left > 0; left -= 1) {
        setState((prev) => ({ ...prev, phase: `금융사 B · 앞 건 정리 대기 ${left}초` }));
        await sleep(1_000);
      }

      await submitDelayed({ target, setup, plan, submit: held.submit });
    } catch (error: unknown) {
      setState((prev) => ({
        ...prev, running: null, phase: null,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      onDone();
    }
  }, [free, wallet, contractAddress, attempt, setPhase, onDone, submitDelayed]);

  /** 들고 있던 B 의 증명으로 다시 낸다. 셋업을 다시 하지 않는다 — 채권을 더 쓰지 않는다. */
  const retryA6Delayed = useCallback(async () => {
    if (!a6Retry) return;
    setState((prev) => ({ ...prev, running: 'A6', phase: null, error: null }));
    try {
      await submitDelayed(a6Retry);
    } catch (error: unknown) {
      setState((prev) => ({
        ...prev, running: null, phase: null,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      onDone();
    }
  }, [a6Retry, submitDelayed, onDone]);

  return (
    <section className="section">
      <header className="section__head">
        <span>실제 체인 공격 재현</span>
        <span className="panel__role">
          {contractAddress
            ? `${onSubmitted ? '원본(제출) 컨트랙트' : '연습용 컨트랙트'} · ${shortHash(`0x${contractAddress}`)}`
            : EMPTY}
        </span>
      </header>
      <div className="section__body">
        <p className="hint">
          트랜잭션마다 지갑 승인이 필요하다. 한 건에 30~45초가 걸리고, 쓴 채권은
          다시 담보로 쓸 수 없다.
        </p>
        {onSubmitted ? (
          <p className="hint hint--error">
            지금 원본(제출) 컨트랙트를 겨누고 있다. README 의 배포 증거가 가리키는 곳이고,
            여기서 쓴 채권은 되돌릴 수 없다. 연습하려면 <code>pnpm dev:rehearsal</code>.
          </p>
        ) : null}

        <div className="btn-row">
          <button
            type="button"
            className="btn"
            disabled={!ready || state.running !== null || free.length === 0}
            onClick={() => void runA5()}
          >
            A5 동시 신청
          </button>
          <button
            type="button"
            className="btn"
            disabled={!ready || state.running !== null || free.length === 0}
            onClick={() => void runA6()}
          >
            A6 지연 제출
          </button>
          {/*
            셋업은 확정됐는데 B 의 제출이 체인 판단 없이 끝났을 때만 나온다.
            [A6 지연 제출] 을 다시 누르면 셋업부터 새로 해서 채권을 하나 더
            쓴다. 이건 들고 있던 증명으로 B 만 다시 낸다.
          */}
          {a6Retry ? (
            <button
              type="button"
              className="btn"
              disabled={!ready || state.running !== null}
              onClick={() => void retryA6Delayed()}
            >
              금융사 B 다시 제출
            </button>
          ) : null}
        </div>
        {a6Retry && state.running === null ? (
          <p className="hint">
            금융사 A 는 확정됐고 금융사 B 의 제출이 체인에 닿기 전에 끝났다(대납 거절 등).
            [금융사 B 다시 제출] 은 미리 만든 증명을 그대로 다시 낸다 — 채권을 더 쓰지 않는다.
            [A6 지연 제출] 을 다시 누르면 처음부터 해서 채권을 하나 더 쓴다.
          </p>
        ) : null}

        <div className="readout">
          <div className="readout__row">
            <span className="readout__key">사용 가능한 채권</span>
            <span className="num">
              {free.length === 0 ? '없음' : `${free.length}건 · ${formatAmount(free[0]!.maxLoanAmount)}`}
            </span>
          </div>
          {state.phase ? (
            <div className="readout__row">
              <span className="readout__key">진행</span>
              <span>{state.phase}</span>
            </div>
          ) : null}
          {state.error ? (
            <div className="readout__row">
              <span className="readout__key">중단</span>
              <span>{state.error}</span>
            </div>
          ) : null}
        </div>

        {(['A5', 'A6'] as const).map((id) => {
          const result = state.results[id];
          if (!result) return null;
          return (
            <div className="attack" key={id}>
              <div className="attack__body">
                <div className="attack__title">
                  {id} · {VERDICT_LABEL[result.verdict]}
                </div>
                <div className="attack__meta">{result.note}</div>
                {result.attempts.map((a: AttemptResult) => (
                  <div className="attack__meta" key={a.lender}>
                    {a.lender} ·{' '}
                    {a.settled ? (
                      <>
                        확정 · 블록 <span className="num">{a.block}</span> ·{' '}
                        <a
                          className="hash"
                          href={`https://preprod.midnightexplorer.com/transactions/${(a.txHash ?? '').replace(/^0x/, '')}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {shortHash(a.txHash ?? '')}
                        </a>
                      </>
                    ) : (
                      <>
                        거부 · {a.code ?? '회로 사유 없음'}
                        {a.chainStatus ? <> · 체인 상태 {a.chainStatus}</> : null}
                        {a.detail ? <> — {a.detail}</> : null}
                      </>
                    )}{' '}
                    · <span className="num">{(a.ms / 1000).toFixed(1)}s</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
