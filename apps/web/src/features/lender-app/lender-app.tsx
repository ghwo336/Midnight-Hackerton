'use client';

import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import {
  DISCLOSURE_FIELDS, DISCLOSURE_LABEL,
  type ApplicationRow, type LenderId,
} from '@/shared/api/types';
import { RoleHeader, type AccountView } from '@/shared/role/role-header';
import { useLive } from '@/shared/role/use-live';
import type { OnceEvent } from '@/shared/sse/use-once-events';
import { EMPTY, formatAmount, shortHash } from '@/shared/ui/format';
import { Stamp, type StampState } from '@/shared/ui/stamp';
import { Checklist } from './checklist';
import { useCheckReveal } from './use-check-reveal';

/**
 * 금융사의 여신 심사 앱.
 *
 * 채권 원문은 props 타입에 자리가 없고 API 응답에도 오지 않는다. 다른
 * 금융사의 예치 잔액·대출·신청도 마찬가지다. 화면이 그 사실을 문장으로
 * 설명하지는 않는다. 실제 제품은 자기가 감추는 것을 설명하지 않는다.
 * 없다는 것은 응답과 DOM으로 증명된다 (test/contract-tests/role-isolation).
 *
 * 증명 생성 단계를 여기 두지 않는다. 증명은 채권 원문을 가진 납품업체 쪽에서
 * 만들어진다. 여기는 받은 증명을 검증한 결과만 본다.
 */
function clock(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

/**
 * 화면에 쓰는 이름.
 *
 * 응답이 오기 전에 lenderId 를 그대로 띄우면 헤더에 'lender-a' 가 번쩍인다.
 * 어떤 회사도 자기 앱 제목에 내부 식별자를 쓰지 않는다.
 */
const LENDER_LABEL: Record<LenderId, string> = {
  'lender-a': '금융사 A',
  'lender-b': '금융사 B',
};

const REASON_TEXT: Record<string, string> = {
  NULLIFIER_ALREADY_USED: '이미 다른 곳에서 사용된 담보',
  AMOUNT_EXCEEDS_LTV: '요청 금액이 담보 한도 초과',
  ISSUER_ATTESTATION_FAILED: '발급 기관이 인증하지 않은 채권',
  OWNERSHIP_VERIFY_FAILED: '발급 기관이 인증하지 않은 채권',
  LENDER_NOT_REGISTERED: '등록되지 않은 금융사',
  INSUFFICIENT_LENDER_FUNDING: '예치 잔액 부족',
  INVOICE_NOT_FOUND: '신청 대상 채권 없음',
};

export function LenderApp({
  lenderId,
  account,
}: {
  lenderId: LenderId;
  account?: AccountView;
}) {
  /** 지금 심사 중인 신청이 있는가. 이벤트로만 알 수 있다. */
  const [pending, setPending] = useState(false);
  const reveal = useCheckReveal(4);

  const state = useQuery({
    queryKey: ['lender', lenderId],
    queryFn: () => api.lender(lenderId),
  });
  const descriptors = useQuery({ queryKey: ['lenderChecks'], queryFn: api.lenderChecks });
  // 갱신은 useLive가 맡는다. 여기서 또 주기를 돌리면 요청만 늘어난다.
  const status = useQuery({ queryKey: ['chain'], queryFn: api.chain });

  useLive(
    'standalone',
    useCallback(
      (event: OnceEvent) => {
        if (event.type !== 'financing.stage') return;
        if (event.lender !== lenderId) return;
        const done = event.stage === 'settled' || event.stage === 'rejected';
        setPending(!done);
        // 판정이 끝난 뒤에 순서를 만든다. 데이터는 이미 확정된 값이다.
        if (done) reveal.play();
      },
      [lenderId, reveal],
    ),
  );

  const applications = state.data?.applications ?? [];
  const latest: ApplicationRow | null = applications[0] ?? null;

  const stamp: StampState = pending
    ? 'pending'
    : latest === null
      ? 'idle'
      : latest.outcome === 'settled'
        ? 'settled'
        : 'rejected';

  /*
   * 회수 완료를 따로 센다. 예치 잔액은 상환으로 복구되므로 잔액만 보면
   * 대출을 실행한 적 없는 것과 구분되지 않는다.
   */
  const loans = state.data?.loans ?? [];
  const open = loans.filter((loan) => !loan.repaid);
  const repaid = loans.filter((loan) => loan.repaid);

  const simulated = status.data?.simulated ?? true;
  const ltv = state.data ? `${Number(state.data.ltvBps) / 100}%` : EMPTY;

  return (
    <div className="roleapp">
      <RoleHeader
        role={state.data?.label ?? LENDER_LABEL[lenderId]}
        product="여신 심사"
        account={account}
      />

      <div className="roleapp__body">
        <section className="section">
          <header className="section__head">
            <span>여신 현황</span>
            <span className="panel__role">담보인정비율 {ltv}</span>
          </header>
          <div className="section__body">
            <Stamp state={stamp} />
            <div className="readout">
              <div className="readout__row">
                <span className="readout__key">예치 잔액</span>
                <span className="num">
                  {state.data ? formatAmount(state.data.vault) : EMPTY}
                </span>
              </div>
              <div className="readout__row">
                <span className="readout__key">진행 중</span>
                <span className="num">
                  {open.length}건 · {formatAmount(
                    open.reduce((acc, loan) => acc + BigInt(loan.amount), 0n).toString(),
                  )}
                </span>
              </div>
              <div className="readout__row">
                <span className="readout__key">회수 완료</span>
                <span className="num">
                  {repaid.length}건 · {formatAmount(
                    repaid.reduce((acc, loan) => acc + BigInt(loan.amount), 0n).toString(),
                  )}
                </span>
              </div>
              <div className="readout__row">
                <span className="readout__key">받은 신청</span>
                <span className="num">{applications.length}건</span>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <header className="section__head">
            <span>대출 신청 큐</span>
            <span className="panel__role">{applications.length}건</span>
          </header>
          <div className="section__body">
            {applications.length === 0 ? (
              <p className="ledger__empty">들어온 신청이 없다.</p>
            ) : (
              applications.map((application) => (
                <article
                  key={application.id}
                  className={`queue queue--${application.outcome}`}
                >
                  <header className="queue__head">
                    <span className="queue__when">{clock(application.receivedAt)}</span>
                    <span className="queue__amount num">
                      {formatAmount(application.amount)}
                    </span>
                    <span
                      className={`status ${
                        application.outcome === 'settled'
                          ? 'status--settled'
                          : 'status--rejected'
                      }`}
                    >
                      {application.outcome === 'settled' ? '지급 완료' : '지급 거부'}
                    </span>
                  </header>

                  {/*
                    제공받은 항목만 그린다.
                    제공되지 않은 항목은 응답에 키 자체가 없다. "비공개"라고
                    적지 않는다. 없는 것은 그냥 없다.
                  */}
                  {DISCLOSURE_FIELDS.some((f) => application.disclosed[f]) ? (
                    <dl className="risk">
                      {DISCLOSURE_FIELDS.filter((f) => application.disclosed[f]).map((f) => (
                        <div key={f} className="risk__row">
                          <dt className="risk__key">{DISCLOSURE_LABEL[f]}</dt>
                          <dd className="risk__val num">{application.disclosed[f]}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}

                  <Checklist
                    descriptors={descriptors.data ?? []}
                    checks={application.checks}
                    shown={application.id === latest?.id ? reveal.shown : undefined}
                  />

                  {application.reason ? (
                    <p className="reject-note">
                      {REASON_TEXT[application.reason] ?? application.reason}
                    </p>
                  ) : null}

                  <div className="queue__meta">
                    <span className="queue__cell">
                      <span className="readout__key">중복 확인값</span>
                      <span className="num">
                        {application.nullifier ? shortHash(application.nullifier) : EMPTY}
                      </span>
                    </span>
                    <span className="queue__cell">
                      <span className="readout__key">{simulated ? '확정 (모의)' : '확정'}</span>
                      <span className="num">
                        {application.block === null ? EMPTY : `블록 ${application.block}`}
                      </span>
                    </span>
                    <span className="queue__cell">
                      <span className="readout__key">{simulated ? 'tx (모의)' : 'tx'}</span>
                      <span className={`num ${simulated ? 'sim' : ''}`}>
                        {application.txHash ? shortHash(application.txHash) : EMPTY}
                      </span>
                    </span>
                    <span className="queue__cell">
                      <span className="readout__key">심사 소요</span>
                      <span className="num">
                        {(application.elapsedMs / 1000).toFixed(2)}s
                      </span>
                    </span>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
