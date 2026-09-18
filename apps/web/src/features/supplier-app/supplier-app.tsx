'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/shared/api/client';
import {
  DISCLOSURE_FIELDS, DISCLOSURE_LABEL,
  type DisclosureField, type LenderId, type SupplierInvoice,
} from '@/shared/api/types';
import { RoleHeader, type AccountView } from '@/shared/role/role-header';
import { useLive } from '@/shared/role/use-live';
import type { OnceEvent } from '@/shared/sse/use-once-events';
import { EMPTY, formatAmount, shortHash } from '@/shared/ui/format';
import { InvoiceRow } from '@/entities/invoice/invoice-row';
import { FundsPanel } from './funds-panel';
import { InvoiceRequestPanel } from './invoice-request';

/** 어디서 쓰였는지 사람이 읽는 이름으로. 내부 식별자를 화면에 쓰지 않는다. */
const LENDER_LABEL: Record<string, string> = {
  'lender-a': '금융사 A',
  'lender-b': '금융사 B',
};
import { ExecutionLog } from '@/shared/ui/execution-log';
import {
  IDLE_RUNTIME, applyStage, beginRequest, progressBar, type LenderRuntime,
} from '@/shared/runtime/financing-runtime';

/**
 * 납품업체의 자금 조달 앱.
 *
 * 공개 원장 전체도, 다른 금융사의 대출 내역도 이 화면에 오지 않는다.
 * 화면이 그 사실을 문장으로 설명하지는 않는다. 실제 제품은 자기가 감추는
 * 것을 설명하지 않는다. 그냥 없다.
 *
 * 증명 생성 로그가 여기 있는 이유: 채권 원문과 소유자 비밀키를 가진 쪽은
 * 납품업체뿐이고, 증명은 그 값들로 만들어진다. 금융사 화면에서 "증명 생성
 * 0.01초"를 보여주면 금융사가 증명을 만든 것처럼 읽힌다.
 */
export function SupplierApp({ account }: { account?: AccountView }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 지금 어느 금융사에 신청 중인가. 로그는 한 줄기다. */
  const [target, setTarget] = useState<LenderId | null>(null);
  const [runtime, setRuntime] = useState<LenderRuntime>(IDLE_RUNTIME);
  /*
   * 이 금융사에 무엇을 내줄지. **기본은 전부 꺼짐이다.**
   *
   * 켜는 것이 사용자의 의식적인 행동이어야 한다. 기본이 켜져 있으면
   * "안 끄면 나간다"가 되고, 그건 선택적 공개가 아니다.
   */
  const [disclose, setDisclose] = useState<readonly DisclosureField[]>([]);
  const [tick, setTick] = useState(0);

  const invoices = useQuery({ queryKey: ['invoices'], queryFn: api.invoices });
  const funds = useQuery({ queryKey: ['funds'], queryFn: api.funds });
  const [repaying, setRepaying] = useState<string | null>(null);

  const repay = useCallback(
    async (loan: { nullifier: string }) => {
      setRepaying(loan.nullifier);
      try {
        await api.repay(loan.nullifier);
      } finally {
        setRepaying(null);
        void queryClient.invalidateQueries();
      }
    },
    [queryClient],
  );
  const terms = useQuery({ queryKey: ['lenderTerms'], queryFn: api.lenderTerms });

  /*
   * 납품업체만 스트림을 쓴다. 증명 생성 단계가 이 화면의 내용 자체이고,
   * 폴링으로는 witness → 증명 → 제출이 지나가는 걸 볼 수 없다.
   * 나머지 화면은 폴링이라 콘솔이 iframe을 띄워도 연결 한도를 먹지 않는다.
   */
  useLive(
    'always',
    useCallback(
      (event: OnceEvent) => {
        if (event.type !== 'financing.stage') return;
        if (target === null || event.lender !== target) return;
        setRuntime((prev) => applyStage(prev, event));
      },
      [target],
    ),
  );

  const inFlight =
    runtime.phase !== 'idle' && runtime.phase !== 'settled' && runtime.phase !== 'rejected';
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(timer);
  }, [inFlight]);
  void tick;

  const list = invoices.data ?? [];
  const selected =
    list.find((invoice) => invoice.invoiceId === selectedId) ??
    list.find((invoice) => !invoice.used) ??
    list[0] ??
    null;

  /*
   * 할 수 없는 행동을 버튼으로 내놓지 않는다.
   *
   * 사용된 채권은 회로가 거부한다(중복 확인값이 이미 등록돼 있다). 그걸
   * 누를 수 있게 두면 화면이 가능하다고 말해 놓고 서버가 거절하는 꼴이
   * 되고, 보는 사람은 제품이 고장난 것으로 읽는다.
   */
  const hasFree = list.some((invoice) => !invoice.used);
  const selectedUsed = selected !== null && selected.used;
  const canApply = selected !== null && !selected.used;

  const sum = (items: readonly SupplierInvoice[], key: 'faceAmount' | 'maxLoanAmount') =>
    items.reduce((acc, item) => acc + BigInt(item[key]), 0n).toString();

  const request = useCallback(
    async (lender: LenderId) => {
      if (!selected) return;
      setBusy(true);
      setTarget(lender);
      setRuntime(beginRequest(new Date().toISOString()));
      setSelectedId(selected.invoiceId);
      try {
        await api.finance(selected.invoiceId, lender, selected.maxLoanAmount, disclose);
      } catch (error: unknown) {
        const code = error instanceof ApiError ? error.code : 'UNKNOWN';
        const assertExpr = error instanceof ApiError ? error.circuitAssert : null;
        setRuntime((prev) => ({
          ...prev, phase: 'rejected', reason: code, circuitAssert: assertExpr,
        }));
      } finally {
        setBusy(false);
        void queryClient.invalidateQueries();
      }
    },
    [selected, disclose, queryClient],
  );

  const ltv = terms.data ? `${Number(terms.data.ltvBps) / 100}%` : EMPTY;

  /*
   * 응답이 오래 걸리면 화면이 그렇다고 말한다.
   *
   * 로컬 회로 실행은 수십 밀리초에 끝난다. 10초가 넘었다면 증명이 느린 게
   * 아니라 요청이 아예 못 나간 것이다. 아무 설명 없이 경과 시간만 올라가면
   * 발표 중에 고장인지 원래 느린 건지 구분할 방법이 없다.
   */
  const elapsedMs = runtime.startedAt === null ? 0 : Date.now() - runtime.startedAt;
  const stalled = inFlight && elapsedMs > 10_000;

  return (
    <div className="roleapp">
      <RoleHeader role="납품업체" product="자금 조달" account={account} />

      <div className="roleapp__body">
        <FundsPanel funds={funds.data} busy={repaying} onRepay={repay} />

        <section className="section">
          <header className="section__head">
            <span>담보 가능한 채권</span>
            <span className="panel__role">{list.length}건</span>
          </header>
          <div className="section__body">
            {list.length === 0 ? (
              <p className="ledger__empty">{EMPTY}</p>
            ) : (
              list.map((invoice, index) => (
                <InvoiceRow
                  key={invoice.invoiceId}
                  invoice={invoice}
                  index={index}
                  selected={invoice.invoiceId === (selected?.invoiceId ?? null)}
                  onSelect={() => setSelectedId(invoice.invoiceId)}
                />
              ))
            )}

            <div className="summary">
              <div className="stages__head">가용 한도</div>
              <div className="summary__row">
                <span className="summary__key">액면 합계</span>
                <span className="num">{formatAmount(sum(list, 'faceAmount'))}</span>
              </div>
              <div className="summary__row">
                <span className="summary__key">담보 한도 합계</span>
                <span className="num">{formatAmount(sum(list, 'maxLoanAmount'))}</span>
              </div>
              <div className="summary__row">
                <span className="summary__key">사용됨</span>
                <span className="num">
                  {list.filter((invoice) => invoice.used).length} / {list.length}
                </span>
              </div>
              <div className="summary__row">
                <span className="summary__key">잔여 한도</span>
                <span className="num">
                  {formatAmount(sum(list.filter((invoice) => !invoice.used), 'maxLoanAmount'))}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <header className="section__head">
            <span>금융사 조건 비교</span>
            <span className="panel__role">담보인정비율 {ltv} · 컨트랙트 공통</span>
          </header>
          <div className="section__body">
            {/*
              미사용 채권이 하나도 없으면 표 자체를 내린다. 신청할 대상이
              없는데 조건을 비교하게 두는 것은 의미가 없다.
            */}
            {!hasFree ? (
              <p className="ledger__empty">신청 가능한 채권이 없습니다.</p>
            ) : (
            <>
            {/*
              무엇을 내줄지 고른다.
              구매기업·채권번호·승인번호는 선택지에 없다. 그 항목들은
              하나만 있어도 거래 상대가 드러나므로 고를 방법 자체를 두지 않는다.
            */}
            <div className="disclose">
              <div className="stages__head">이 금융사에 제공할 정보</div>
              {DISCLOSURE_FIELDS.map((field) => {
                const on = disclose.includes(field);
                return (
                  <label key={field} className="disclose__row">
                    <input
                      type="checkbox"
                      className="disclose__box"
                      checked={on}
                      disabled={!canApply}
                      onChange={() =>
                        setDisclose((prev) =>
                          on ? prev.filter((f) => f !== field) : [...prev, field],
                        )
                      }
                    />
                    <span className="disclose__label">{DISCLOSURE_LABEL[field]}</span>
                    <span className="disclose__value num">
                      {canApply && selected ? selected.risk[field] : EMPTY}
                    </span>
                  </label>
                );
              })}
              <p className="hint">
                {disclose.length === 0
                  ? '아무것도 제공하지 않으면 금융사는 검증 결과만 본다'
                  : `${disclose.length}개 항목을 신청과 함께 보낸다`}
              </p>
            </div>

            <table className="terms">
              <colgroup>
                <col />
                <col className="c-amount" />
                <col className="c-amount" />
                <col className="c-lender" />
              </colgroup>
              <thead>
                <tr>
                  <th>금융사</th>
                  <th className="num">예치 잔액</th>
                  <th className="num">이 채권 신청액</th>
                  <th>신청</th>
                </tr>
              </thead>
              <tbody>
                {(terms.data?.lenders ?? []).map((lender) => {
                  const amount = canApply ? (selected?.maxLoanAmount ?? '0') : '0';
                  const fundable = BigInt(lender.vault) >= BigInt(amount);
                  return (
                    <tr key={lender.lenderId}>
                      <td>{lender.label}</td>
                      <td className="num">{formatAmount(lender.vault)}</td>
                      <td className="num">{canApply ? formatAmount(amount) : EMPTY}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--inline"
                          disabled={busy || !canApply || !fundable}
                          onClick={() => void request(lender.lenderId)}
                        >
                          {canApply && !fundable ? '자금 부족' : '신청'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </>
            )}
            <p className={`hint ${stalled || selectedUsed ? 'hint--error' : ''}`}>
              {stalled
                ? '응답이 오지 않는다. 로컬 실행은 1초 안에 끝난다. 서버가 떠 있는지 확인한다'
                : selectedUsed
                  ? `이미 사용된 채권입니다 · ${
                      LENDER_LABEL[selected?.usedBy ?? ''] ?? '다른 금융사'
                    }${selected?.usedBlock === null ? '' : ` · 블록 ${selected?.usedBlock}`}`
                  : selected
                    ? `채권 #${list.findIndex((i) => i.invoiceId === selected.invoiceId) + 1} 선택됨`
                    : '신청할 채권이 없다'}
            </p>
          </div>
        </section>

        <section className="section">
          <header className="section__head">
            <span>증명 생성</span>
          </header>
          <div className="section__body">
            <div className="readout">
              <div className="readout__row">
                <span className="readout__key">신청 대상</span>
                <span>
                  {target === null
                    ? EMPTY
                    : (terms.data?.lenders.find((l) => l.lenderId === target)?.label ?? target)}
                </span>
              </div>
              <div className="readout__row">
                <span className="readout__key">진행</span>
                <span className="num">
                  {inFlight ? (
                    <>
                      <span className="bar">{progressBar(runtime.phase)}</span>{' '}
                      {runtime.startedAt === null
                        ? EMPTY
                        : `${((Date.now() - runtime.startedAt) / 1000).toFixed(1)}s`}
                    </>
                  ) : runtime.phase === 'settled' ? (
                    '확정'
                  ) : runtime.phase === 'rejected' ? (
                    '거부됨'
                  ) : (
                    EMPTY
                  )}
                </span>
              </div>
              {selected ? (
                <div className="readout__row">
                  <span className="readout__key">채권 식별자</span>
                  <span className="num">{shortHash(selected.invoiceId)}</span>
                </div>
              ) : null}
            </div>

            <div className="stages__head">실행 로그</div>
            <ExecutionLog lines={runtime.log} />
          </div>
        </section>

        <InvoiceRequestPanel />
      </div>
    </div>
  );
}
