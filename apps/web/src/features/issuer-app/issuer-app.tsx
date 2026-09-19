'use client';

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/shared/api/client';
import type { IssueResult } from '@/shared/api/types';
import { RoleHeader, type AccountView } from '@/shared/role/role-header';
import { useLive } from '@/shared/role/use-live';
import { EMPTY, formatAmount, shortHash } from '@/shared/ui/format';
import type { WalletSession } from '@/shared/wallet/session';
import { TX_PHASE_LABEL, type TxPhase } from '@/shared/runtime/tx-phase';

/**
 * 발급 기관 콘솔.
 *
 * 발급 기관은 채권을 만드는 주체라 원문을 안다. 하지만 발급하고 나면
 * 원문은 납품업체 쪽에만 남고 원장에는 리프 하나가 들어간다.
 *
 * 발급 전후로 루트가 바뀌는데, 그 사이에 원장에 올라간 것은 32바이트 해시
 * 하나뿐이다. 금융사는 나중에 이 루트 하나로 "발급 기관이 인증한 채권인가"를
 * 원문 없이 검증한다. 화면은 그 사실을 문장으로 설명하지 않고 값만 보여준다.
 */
const EMPTY_FORM = {
  faceAmount: '',
  counterparty: '',
  dueDate: '',
  approvalNumber: '',
  memo: '',
};

export function IssuerApp({
  account,
  /**
   * 연결된 지갑.
   *
   * 실제 체인에서는 이것이 있어야 발급할 수 있다. 서버는 서명하지 않고,
   * 발급 기관 비밀키도 서버에 없다.
   */
  wallet,
}: { account?: AccountView; wallet?: WalletSession | null }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IssueResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<TxPhase | null>(null);

  const state = useQuery({ queryKey: ['issuer'], queryFn: api.issuer });
  const pending = useQuery({ queryKey: ['pendingRequests'], queryFn: api.pendingRequests });
  const chain = useQuery({ queryKey: ['chain'], queryFn: api.chain });
  const [approving, setApproving] = useState<string | null>(null);
  useLive('standalone');

  /*
   * 실제 체인인가.
   *
   * 체인이 대답할 때까지는 아무 경로도 고르지 않는다. 모르는 동안
   * 시뮬레이터로 가정하면, 실제 체인에서 서버가 서명하려 들고
   * SERVER_CANNOT_SIGN 으로 죽는다.
   */
  const onChain = chain.data ? !chain.data.simulated : null;
  const contractAddress = chain.data?.contractAddress ?? null;
  const needsWallet = onChain === true && !wallet;

  /**
   * 리프를 지갑으로 올린다.
   *
   * 발급 기관 비밀키는 이 기기의 IndexedDB 에서 witness 로 들어간다.
   * 회로가 `issuerPublicKey(issuerSecret()) == issuerPk` 를 보므로, 성공은
   * 그 값이 올바른 비밀키였다는 뜻이다 — 로그가 아니라 회로가 증명한다.
   */
  const putLeafOnChain = useCallback(
    async (plan: { issuanceId: string; leaf: string; rootBefore: string }) => {
      if (!wallet || !contractAddress) throw new Error('지갑이 연결되지 않았다');
      const { registerInvoiceOnChain } = await import('@/shared/wallet/circuit-calls');
      const tx = await registerInvoiceOnChain(wallet, contractAddress, plan.leaf, setPhase);
      const confirmed = await api.confirmIssue(plan.issuanceId, tx.txHash, tx.block);
      return {
        invoiceId: confirmed.invoiceId,
        rootBefore: plan.rootBefore,
        rootAfter: confirmed.rootAfter,
        invoiceCount: confirmed.invoiceCount,
      } satisfies IssueResult;
    },
    [wallet, contractAddress],
  );

  const approve = useCallback(
    async (requestId: string) => {
      if (onChain === null) return;
      setApproving(requestId);
      setError(null);
      try {
        setResult(
          onChain
            ? await putLeafOnChain(await api.prepareApprove(requestId))
            : await api.approveRequest(requestId),
        );
      } catch (caught: unknown) {
        setError(
          caught instanceof ApiError
            ? caught.code
            : caught instanceof Error
              ? caught.message
              : '승인하지 못했다',
        );
      } finally {
        setApproving(null);
        setPhase(null);
        void queryClient.invalidateQueries();
      }
    },
    [queryClient, onChain, putLeafOnChain],
  );

  const set = (key: keyof typeof EMPTY_FORM) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const digits = form.faceAmount.replace(/[^0-9]/g, '');
  const ready =
    digits !== '' &&
    form.counterparty.trim() !== '' &&
    form.dueDate.trim() !== '' &&
    form.approvalNumber.trim() !== '';

  const issue = useCallback(async () => {
    if (onChain === null) return;
    setBusy(true);
    setError(null);
    const body = {
      faceAmount: digits,
      counterparty: form.counterparty.trim(),
      dueDate: form.dueDate.trim(),
      approvalNumber: form.approvalNumber.trim(),
      memo: form.memo.trim(),
    };
    try {
      setResult(
        onChain
          ? await putLeafOnChain(await api.prepareIssue(body))
          : await api.issueInvoice(body),
      );
      setForm(EMPTY_FORM);
    } catch (caught: unknown) {
      setError(
        caught instanceof ApiError
          ? caught.code
          : caught instanceof Error
            ? caught.message
            : '발급 실패',
      );
    } finally {
      setBusy(false);
      setPhase(null);
      void queryClient.invalidateQueries();
    }
  }, [digits, form, queryClient, onChain, putLeafOnChain]);

  return (
    <div className="roleapp">
      <RoleHeader role="발급 기관" product="채권 발행" account={account} />

      <div className="roleapp__body">
        <section className="section">
          <header className="section__head">
            <span>발급 현황</span>
          </header>
          <div className="section__body">
            <div className="readout">
              <div className="readout__row">
                <span className="readout__key">발급 기관 식별자</span>
                <span className="num">
                  {state.data ? shortHash(state.data.issuerId) : EMPTY}
                </span>
              </div>
              <div className="readout__row">
                <span className="readout__key">현재 issuerRoot</span>
                <span className="num">
                  {state.data ? shortHash(state.data.issuerRoot) : EMPTY}
                </span>
              </div>
              <div className="readout__row">
                <span className="readout__key">등록 건수</span>
                <span className="num">{state.data?.invoiceCount ?? EMPTY}</span>
              </div>
              <div className="readout__row">
                <span className="readout__key">담보인정비율</span>
                <span className="num">
                  {state.data ? `${Number(state.data.ltvBps) / 100}%` : EMPTY}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <header className="section__head">
            <span>승인 대기</span>
            <span className="panel__role">{pending.data?.length ?? 0}건</span>
          </header>
          <div className="section__body">
            {(pending.data?.length ?? 0) === 0 ? (
              <p className="ledger__empty">대기 중인 요청이 없다.</p>
            ) : (
              <table className="terms">
                <thead>
                  <tr>
                    <th className="num">액면</th>
                    <th>등급</th>
                    <th>업종</th>
                    <th>승인</th>
                  </tr>
                </thead>
                <tbody>
                  {(pending.data ?? []).map((entry) => (
                    <tr key={entry.id}>
                      <td className="num">{formatAmount(entry.faceAmount)}</td>
                      <td className="num">{entry.risk.creditGrade}</td>
                      <td>{entry.risk.industry}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--inline"
                          disabled={approving !== null || needsWallet}
                          onClick={() => void approve(entry.id)}
                        >
                          {approving === entry.id
                            ? (phase ? TX_PHASE_LABEL[phase] : '승인 중')
                            : '승인'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="section">
          <header className="section__head">
            <span>채권 발행</span>
          </header>
          <div className="section__body">
            <div className="form">
              <label className="field">
                <span className="field__label">액면금액</span>
                <input
                  className="field__input num"
                  inputMode="numeric"
                  value={form.faceAmount}
                  onChange={set('faceAmount')}
                  placeholder="100000000"
                />
              </label>
              <label className="field">
                <span className="field__label">구매기업</span>
                <input
                  className="field__input"
                  value={form.counterparty}
                  onChange={set('counterparty')}
                  placeholder="대한전자 주식회사"
                />
              </label>
              <label className="field">
                <span className="field__label">지급일</span>
                <input
                  className="field__input num"
                  value={form.dueDate}
                  onChange={set('dueDate')}
                  placeholder="2026-10-31"
                />
              </label>
              <label className="field">
                <span className="field__label">국세청 승인번호</span>
                <input
                  className="field__input num"
                  value={form.approvalNumber}
                  onChange={set('approvalNumber')}
                  placeholder="20260917-41002983-11223344"
                />
              </label>
              <label className="field">
                <span className="field__label">비고</span>
                <input
                  className="field__input"
                  value={form.memo}
                  onChange={set('memo')}
                  placeholder="9월 정밀부품 납품분"
                />
              </label>
            </div>

            <p className={`hint ${needsWallet ? 'hint--error' : ''}`}>
              {/*
                지갑이 있어야 서명할 수 있다는 사실을 버튼을 누른 뒤가
                아니라 누르기 전에 말한다.
              */}
              {needsWallet
                ? '발급하려면 지갑을 연결해야 합니다'
                : digits === ''
                  ? '액면금액은 숫자만 입력한다'
                  : `액면 ${formatAmount(digits)}`}
            </p>
            {error ? <p className="hint hint--error">{error}</p> : null}

            {/*
              무엇을 기다리는 중인지 말한다.

              실제 체인은 한 건에 30~45초이고 그 대부분이 지갑 승인과 블록
              확정이다. "발급 중" 한 마디만 두면 멈춘 것처럼 보인다.
            */}
            {phase ? (
              <p className="hint">
                {TX_PHASE_LABEL[phase]}
                {phase === 'balancing' ? ' — 지갑 창을 확인한다' : ''}
              </p>
            ) : null}

            <div className="btn-row">
              <button
                type="button"
                className="btn"
                disabled={busy || !ready || needsWallet}
                onClick={() => void issue()}
              >
                {busy ? (phase ? TX_PHASE_LABEL[phase] : '발급 중') : '채권 발급'}
              </button>
            </div>
          </div>
        </section>

        {result ? (
          <section className="section">
            <header className="section__head">
              <span>마지막 발급</span>
            </header>
            <div className="section__body">
              <div className="readout">
                <div className="readout__row">
                  <span className="readout__key">채권 식별자</span>
                  <span className="num">{shortHash(result.invoiceId)}</span>
                </div>
                <div className="readout__row">
                  <span className="readout__key">루트 (이전)</span>
                  <span className="num">{shortHash(result.rootBefore)}</span>
                </div>
                <div className="readout__row">
                  <span className="readout__key">루트 (이후)</span>
                  <span className="num">{shortHash(result.rootAfter)}</span>
                </div>
                <div className="readout__row">
                  <span className="readout__key">등록 건수</span>
                  <span className="num">{result.invoiceCount}</span>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
