'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/shared/api/client';
import type { LenderId, SupplierInvoice } from '@/shared/api/types';
import { RoleHeader } from '@/shared/role/role-header';
import { useLive } from '@/shared/role/use-live';
import type { OnceEvent } from '@/shared/sse/use-once-events';
import { EMPTY, formatAmount, shortHash } from '@/shared/ui/format';
import { InvoiceRow } from '@/entities/invoice/invoice-row';
import { ExecutionLog } from '@/shared/ui/execution-log';
import {
  IDLE_RUNTIME, applyStage, beginRequest, progressBar, type LenderRuntime,
} from '@/shared/runtime/financing-runtime';

/**
 * 납품업체의 자금 조달 앱.
 *
 * 이 화면에 없는 것:
 *   - 공개 원장 전체 (내 채권의 사용 여부만 파생해서 본다)
 *   - 다른 금융사의 대출 내역
 *   - 다른 납품업체의 무엇이든
 *
 * 증명 생성 로그가 여기 있는 이유: 채권 원문과 소유자 비밀키를 가진 쪽은
 * 납품업체뿐이고, 증명은 그 값들로 만들어진다. 금융사 화면에서 "증명 생성
 * 0.01초"를 보여주면 금융사가 증명을 만든 것처럼 읽힌다.
 */
export function SupplierApp() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 지금 어느 금융사에 신청 중인가. 로그는 한 줄기다. */
  const [target, setTarget] = useState<LenderId | null>(null);
  const [runtime, setRuntime] = useState<LenderRuntime>(IDLE_RUNTIME);
  const [tick, setTick] = useState(0);

  const invoices = useQuery({ queryKey: ['invoices'], queryFn: api.invoices });
  const terms = useQuery({ queryKey: ['lenderTerms'], queryFn: api.lenderTerms });

  // 내 신청의 진행 단계만 따라간다. 다른 금융사에 간 신청은 내 것이 아니다.
  useLive(
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
        await api.finance(selected.invoiceId, lender, selected.maxLoanAmount);
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
    [selected, queryClient],
  );

  const ltv = terms.data ? `${Number(terms.data.ltvBps) / 100}%` : EMPTY;

  return (
    <div className="roleapp">
      <RoleHeader
        role="납품업체"
        product="자금 조달"
        current="/supplier"
        note="다른 금융사의 대출 내역과 공개 원장 전체는 이 화면에 없다"
      />

      <div className="roleapp__body">
        <section className="section">
          <header className="section__head">
            <span>보유 채권</span>
            <span className="panel__role">{list.length}건 · 원문은 이 기기에만</span>
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
                  const amount = selected?.maxLoanAmount ?? '0';
                  const fundable = BigInt(lender.vault) >= BigInt(amount);
                  return (
                    <tr key={lender.lenderId}>
                      <td>{lender.label}</td>
                      <td className="num">{formatAmount(lender.vault)}</td>
                      <td className="num">{selected ? formatAmount(amount) : EMPTY}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--inline"
                          disabled={busy || !selected || !fundable}
                          onClick={() => void request(lender.lenderId)}
                        >
                          {fundable ? '신청' : '자금 부족'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="hint">
              {selected
                ? `채권 #${list.findIndex((i) => i.invoiceId === selected.invoiceId) + 1} 선택됨`
                : '신청할 채권이 없다'}
            </p>
          </div>
        </section>

        <section className="section">
          <header className="section__head">
            <span>증명 생성</span>
            <span className="panel__role">채권 원문은 이 기기를 떠나지 않는다</span>
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
              <div className="readout__row">
                <span className="readout__key">전송한 것</span>
                <span className="num">
                  {runtime.phase === 'idle'
                    ? EMPTY
                    : '증명 · 중복 확인값 · 봉인값 · 금액'}
                </span>
              </div>
              <div className="readout__row">
                <span className="readout__key">전송하지 않은 것</span>
                <span className="num">
                  {runtime.phase === 'idle' ? EMPTY : '구매기업 · 지급일 · 승인번호'}
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
      </div>
    </div>
  );
}
