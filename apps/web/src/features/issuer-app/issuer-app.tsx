'use client';

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/shared/api/client';
import type { IssueResult } from '@/shared/api/types';
import { RoleHeader } from '@/shared/role/role-header';
import { useLive } from '@/shared/role/use-live';
import { EMPTY, formatAmount, shortHash } from '@/shared/ui/format';

/**
 * 발급 기관 콘솔.
 *
 * 발급 기관은 채권을 만드는 주체라 원문을 안다. 하지만 발급하고 나면
 * 원문은 납품업체 쪽에만 남고 원장에는 리프 하나가 들어간다.
 *
 * 이 화면의 증거는 **루트 전이**다. 발급 전후로 루트가 바뀌는데, 그 사이에
 * 원장에 올라간 것은 32바이트 해시 하나뿐이다. 금융사는 나중에 이 루트
 * 하나로 "발급 기관이 인증한 채권인가"를 원문 없이 검증한다.
 */
const EMPTY_FORM = {
  faceAmount: '',
  counterparty: '',
  dueDate: '',
  approvalNumber: '',
  memo: '',
};

export function IssuerApp() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IssueResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const state = useQuery({ queryKey: ['issuer'], queryFn: api.issuer });
  useLive();

  const set = (key: keyof typeof EMPTY_FORM) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const digits = form.faceAmount.replace(/[^0-9]/g, '');
  const ready =
    digits !== '' &&
    form.counterparty.trim() !== '' &&
    form.dueDate.trim() !== '' &&
    form.approvalNumber.trim() !== '';

  const issue = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.issueInvoice({
          faceAmount: digits,
          counterparty: form.counterparty.trim(),
          dueDate: form.dueDate.trim(),
          approvalNumber: form.approvalNumber.trim(),
          memo: form.memo.trim(),
        }),
      );
      setForm(EMPTY_FORM);
    } catch (caught: unknown) {
      setError(caught instanceof ApiError ? caught.code : '발급 실패');
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries();
    }
  }, [digits, form, queryClient]);

  return (
    <div className="roleapp">
      <RoleHeader
        role="발급 기관"
        product="채권 발행"
        current="/issuer"
        note="발급 후 원문은 납품업체에만 남는다. 원장에는 리프 해시 하나"
      />

      <div className="roleapp__body">
        <section className="section">
          <header className="section__head">
            <span>발급 현황</span>
            <span className="panel__role">전부 공개값</span>
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
            <span>채권 발행</span>
            <span className="panel__role">아래 값 중 원장에 올라가는 것은 없다</span>
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

            <p className="hint">
              {digits === ''
                ? '액면금액은 숫자만 입력한다'
                : `액면 ${formatAmount(digits)} · 담보 한도는 컨트랙트가 계산한다`}
            </p>
            {error ? <p className="hint hint--error">{error}</p> : null}

            <div className="btn-row">
              <button
                type="button"
                className="btn"
                disabled={busy || !ready}
                onClick={() => void issue()}
              >
                {busy ? '발급 중' : '채권 발급'}
              </button>
            </div>
          </div>
        </section>

        {result ? (
          <section className="section">
            <header className="section__head">
              <span>마지막 발급</span>
              <span className="panel__role">원장에 올라간 것은 루트 변경뿐</span>
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
              <p className="hint">
                방금 입력한 구매기업·지급일·승인번호는 이 응답에 없다. 트리는
                자랐고 루트는 바뀌었지만, 무엇이 들어갔는지는 원장에서 읽을 수 없다.
              </p>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
