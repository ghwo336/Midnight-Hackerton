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
   * 실패도 결과의 일부다.
   */
  const attempt = useCallback(
    async (
      invoice: SupplierInvoice,
      lender: LenderId,
      /** 미리 만들어 둔 제출 함수. A6 이 준비와 제출을 벌릴 때 쓴다. */
      prepared?: () => Promise<{ txHash: string; block: number }>,
    ): Promise<AttemptResult> => {
      const started = Date.now();
      /*
       * 시작·종료 시각을 남긴다. judgeA5 가 두 신청이 실제로 겹쳤는지
       * 보고, 겹치지 않았으면 통과로 세지 않는다 — 지갑이 직렬화하면
       * 순차로 나가고, 그건 합의 경합을 시험한 것이 아니다.
       */
      const base = { lender, ms: 0, txHash: null, block: null, startedAt: started } as const;
      if (!wallet || !contractAddress) {
        return {
          ...base, settled: false, code: null, detail: '지갑이 연결되지 않았다',
          ms: 0, endedAt: Date.now(),
        };
      }

      const { classifyCircuitError, describe, financeOnChain } =
        await import('@/shared/wallet/circuit-calls');

      let plan: Awaited<ReturnType<typeof api.prepareFinancing>>;
      try {
        plan = await api.prepareFinancing(invoice.invoiceId, lender, invoice.maxLoanAmount, []);
      } catch (error: unknown) {
        // 사전 검사에서 걸렸다. 회로까지 가지 않았으므로 code 를 비운다.
        return {
          ...base, settled: false, code: null,
          detail: error instanceof ApiError ? error.code : String(error),
          ms: Date.now() - started, endedAt: Date.now(),
        };
      }

      const report = async (
        outcome: 'settled' | 'rejected',
        txHash: string | null,
        block: number | null,
        reason: string | null,
      ) => {
        await api
          .confirmFinancing({
            applicationId: plan.applicationId,
            invoiceId: invoice.invoiceId,
            lenderId: lender,
            amount: plan.amount,
            nullifier: plan.nullifier,
            receivedAt: plan.receivedAt,
            elapsedMs: Date.now() - started,
            disclose: [],
            outcome,
            txHash,
            block,
            reason,
          })
          .catch(() => undefined);
      };

      try {
        const result = prepared
          ? await prepared()
          : await financeOnChain(wallet, contractAddress, plan, (phase) => setPhase(lender, phase));
        await report('settled', result.txHash, result.block, null);
        return {
          lender, settled: true, code: null, detail: null,
          txHash: result.txHash, block: result.block,
          ms: Date.now() - started, startedAt: started, endedAt: Date.now(),
        };
      } catch (error: unknown) {
        const code = classifyCircuitError(error);
        await report('rejected', null, null, code);
        return {
          lender, settled: false, code, detail: code === null ? describe(error) : null,
          txHash: null, block: null,
          ms: Date.now() - started, startedAt: started, endedAt: Date.now(),
        };
      }
    },
    [wallet, contractAddress, setPhase],
  );

  /**
   * A5: 두 금융사에 동시에 낸다.
   *
   * 두 제출을 정말 병렬로 띄운다. 순서대로 보내면 뒤엣것은 사전 검사에서
   * 걸려 회로에 닿지 않고, 그러면 "실행 시점 재검사" 를 시험한 것이
   * 아니다. 지갑 승인 창이 두 개 뜬다.
   */
  const runA5 = useCallback(async () => {
    const target = free[0];
    if (!target) return;
    if (!confirmTarget('A5')) return;
    setState({ running: 'A5', phase: null, results: {}, error: null });
    try {
      const attempts = await Promise.all([
        attempt(target, 'lender-a'),
        attempt(target, 'lender-b'),
      ]);
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
  }, [free, attempt, onDone, contractAddress]);

  /**
   * A6: 비어 있을 때 준비하고, 채워진 뒤에 낸다.
   *
   * 금융사 B 의 신청을 **먼저** 준비한다. 그 시점에 원장의 중복 확인값은
   * 비어 있다. 그다음 금융사 A 가 정상으로 대출을 확정시키고, 준비해 둔
   * 신청을 그제서야 제출한다.
   */
  const runA6 = useCallback(async () => {
    const target = free[0];
    if (!target || !wallet || !contractAddress) return;
    if (!confirmTarget('A6')) return;
    setState({ running: 'A6', phase: null, results: {}, error: null });
    try {
      const { prepareFinanceCall } = await import('@/shared/wallet/circuit-calls');

      setState((prev) => ({ ...prev, phase: '금융사 B · 미사용 시점에 신청 준비' }));
      const plan = await api.prepareFinancing(
        target.invoiceId, 'lender-b', target.maxLoanAmount, [],
      );
      const held = await prepareFinanceCall(wallet, contractAddress, plan, (phase) =>
        setPhase('lender-b(준비)', phase),
      );

      setState((prev) => ({ ...prev, phase: '금융사 A · 정상 대출 실행' }));
      const setup = await attempt(target, 'lender-a');

      setState((prev) => ({ ...prev, phase: '금융사 B · 지연 제출' }));
      const delayed = await attempt(target, 'lender-b', async () => {
        const out = await held.submit();
        return { txHash: out.txHash, block: out.block };
      });

      setState((prev) => ({
        ...prev, running: null, phase: null,
        results: { ...prev.results, A6: judgeA6(setup, delayed) },
      }));
    } catch (error: unknown) {
      setState((prev) => ({
        ...prev, running: null, phase: null,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      onDone();
    }
  }, [free, wallet, contractAddress, attempt, setPhase, onDone]);

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
        </div>

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
                      <>거부 · {a.code ?? a.detail ?? '사유 없음'}</>
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
