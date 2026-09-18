'use client';

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/shared/api/client';
import { EMPTY, formatAmount } from '@/shared/ui/format';

const EMPTY_FORM = {
  faceAmount: '',
  counterparty: '',
  dueDate: '',
  approvalNumber: '',
  memo: '',
  creditGrade: 'BBB',
  dueWindow: '60~90일',
  industry: '',
};

const STATUS_TEXT: Record<string, string> = {
  pending: '확인 대기',
  approved: '등록됨',
  rejected: '반려',
};

function clock(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes()].map((n) => String(n).padStart(2, '0')).join(':');
}

/**
 * 채권 등록 요청.
 *
 * 발급 기관이 승인해야 Merkle 리프가 들어가고 루트가 바뀐다. 승인 전에는
 * 회로의 checkRoot 가 그 채권을 거부한다. 그래서 "확인 대기" 동안에는
 * 담보로 쓸 수 없고, 화면도 그 상태를 그대로 보여준다.
 */
export function InvoiceRequestPanel() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requests = useQuery({ queryKey: ['myRequests'], queryFn: api.myRequests });

  const set = (key: keyof typeof EMPTY_FORM) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const digits = form.faceAmount.replace(/[^0-9]/g, '');
  const ready =
    digits !== '' &&
    form.counterparty.trim() !== '' &&
    form.dueDate.trim() !== '' &&
    form.approvalNumber.trim() !== '' &&
    form.industry.trim() !== '';

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.requestInvoice({
        faceAmount: digits,
        counterparty: form.counterparty.trim(),
        dueDate: form.dueDate.trim(),
        approvalNumber: form.approvalNumber.trim(),
        memo: form.memo.trim(),
        creditGrade: form.creditGrade.trim(),
        dueWindow: form.dueWindow.trim(),
        industry: form.industry.trim(),
      });
      setForm(EMPTY_FORM);
    } catch (caught: unknown) {
      setError(caught instanceof ApiError ? caught.message : '요청하지 못했다.');
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries();
    }
  }, [digits, form, queryClient]);

  const list = requests.data ?? [];

  return (
    <section className="section">
      <header className="section__head">
        <span>채권 등록 요청</span>
        <span className="panel__role">
          {list.length === 0 ? EMPTY : `${list.length}건`}
        </span>
      </header>
      <div className="section__body">
        {list.length > 0 ? (
          <table className="terms">
            <thead>
              <tr>
                <th>요청 시각</th>
                <th className="num">액면</th>
                <th>등급</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {list.map((entry) => (
                <tr key={entry.id}>
                  <td className="num">{clock(entry.requestedAt)}</td>
                  <td className="num">{formatAmount(entry.faceAmount)}</td>
                  <td className="num">{entry.risk.creditGrade}</td>
                  <td
                    className={entry.status === 'approved' ? 'check--pass' : ''}
                  >
                    {STATUS_TEXT[entry.status] ?? entry.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <div className="form">
          <label className="field">
            <span className="field__label">액면금액</span>
            <input className="field__input num" inputMode="numeric"
              value={form.faceAmount} onChange={set('faceAmount')} placeholder="100000000" />
          </label>
          <label className="field">
            <span className="field__label">구매기업</span>
            <input className="field__input" value={form.counterparty}
              onChange={set('counterparty')} placeholder="대한전자 주식회사" />
          </label>
          <label className="field">
            <span className="field__label">지급일</span>
            <input className="field__input num" value={form.dueDate}
              onChange={set('dueDate')} placeholder="2026-10-31" />
          </label>
          <label className="field">
            <span className="field__label">국세청 승인번호</span>
            <input className="field__input num" value={form.approvalNumber}
              onChange={set('approvalNumber')} placeholder="20260917-41002983-11223344" />
          </label>
          <label className="field">
            <span className="field__label">채무자 신용등급</span>
            <input className="field__input num" value={form.creditGrade}
              onChange={set('creditGrade')} placeholder="BBB" />
          </label>
          <label className="field">
            <span className="field__label">지급 예정일 구간</span>
            <input className="field__input" value={form.dueWindow}
              onChange={set('dueWindow')} placeholder="60~90일" />
          </label>
          <label className="field">
            <span className="field__label">업종 분류</span>
            <input className="field__input" value={form.industry}
              onChange={set('industry')} placeholder="전자부품 제조" />
          </label>
        </div>

        {error ? <p className="hint hint--error">{error}</p> : null}

        <div className="btn-row">
          <button type="button" className="btn" disabled={busy || !ready}
            onClick={() => void submit()}>
            {busy ? '요청 중' : '등록 요청'}
          </button>
        </div>
      </div>
    </section>
  );
}
