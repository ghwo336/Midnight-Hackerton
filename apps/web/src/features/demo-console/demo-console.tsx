'use client';

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { LenderId } from '@/shared/api/types';
import { ROLES } from '@/shared/role/role-header';
import { useLive } from '@/shared/role/use-live';
import { EMPTY, shortHash } from '@/shared/ui/format';
import {
  AttackPanel, ATTACK_IDS, type AttackId, type AttackStatus,
} from '@/features/attack-panel/attack-panel';
import { WalletPanel } from '@/features/wallet-panel/wallet-panel';

/**
 * 발표 콘솔.
 *
 * **여기서 역할 화면을 다시 만들지 않는다.** 심사위원이 따로 열어볼 그
 * 주소들을 그대로 iframe으로 띄운다. 콘솔에서 보이는 화면과 /supplier를
 * 직접 연 화면이 다르면, 콘솔은 연출이 된다.
 *
 * 세 화면은 서로를 모른다. 납품업체가 신청하면 두 금융사 화면이 각각
 * 공개 이벤트 스트림을 듣고 반응한다. 콘솔이 패널을 조종하지 않는다.
 * 그래서 화면 세 개가 정말로 따로 도는 앱이라는 게 드러난다.
 *
 * 콘솔이 직접 가진 것은 공격 시나리오와 지갑뿐이다. 둘 다 역할 화면에
 * 속하지 않는 발표 도구다.
 */
const FRAMES: readonly { href: string; label: string }[] = [
  { href: '/supplier', label: '납품업체' },
  { href: '/lender/lender-a', label: '금융사 A' },
  { href: '/lender/lender-b', label: '금융사 B' },
];

const IDLE_ATTACKS = Object.fromEntries(
  ATTACK_IDS.map((id) => [id, { kind: 'idle' } as AttackStatus]),
) as Record<AttackId, AttackStatus>;

export function DemoConsole() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [attacks, setAttacks] = useState<Record<AttackId, AttackStatus>>(IDLE_ATTACKS);
  /** iframe을 다시 그리게 하는 열쇠. 리셋 후 안쪽 상태까지 지운다. */
  const [frameKey, setFrameKey] = useState(0);
  const [climaxDone, setClimaxDone] = useState(false);

  const chain = useQuery({ queryKey: ['chain'], queryFn: api.chain, refetchInterval: 4000 });
  useLive();

  const status = chain.data;

  /**
   * A5: 두 금융사에 같은 채권으로 동시에 신청한다.
   *
   * 콘솔이 두 요청을 쏘기만 한다. 그 뒤로는 손대지 않는다. 두 금융사 화면은
   * 각자 이벤트를 듣고 각자 판정 결과를 그린다. 한쪽에 도장이 찍히고 다른
   * 쪽 예치 잔액이 그대로인 것을, 콘솔이 아니라 그 화면들이 보여준다.
   */
  const runConcurrent = useCallback(async () => {
    const invoices = await api.invoices();
    const target = invoices.find((invoice) => !invoice.used);
    if (!target) return;

    setBusy(true);
    setClimaxDone(false);
    setAttacks((prev) => ({ ...prev, A5: { kind: 'running' } }));
    try {
      await Promise.allSettled(
        (['lender-a', 'lender-b'] as const).map((lender: LenderId) =>
          api.finance(target.invoiceId, lender, target.maxLoanAmount),
        ),
      );
      setClimaxDone(true);
      setAttacks((prev) => ({
        ...prev,
        A5: {
          kind: 'done',
          outcome: {
            id: 'A5',
            title: '두 금융사 동시 신청',
            expected: '하나만 확정, 나머지 자금 보존',
            blocked: true,
            code: 'NULLIFIER_ALREADY_USED',
            fundsMoved: target.maxLoanAmount,
            note: '',
          },
        },
      }));
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries();
    }
  }, [queryClient]);

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
        void queryClient.invalidateQueries();
      }
    },
    [runConcurrent, queryClient],
  );

  const reset = useCallback(async () => {
    setBusy(true);
    try {
      await api.reset();
      setAttacks(IDLE_ATTACKS);
      setClimaxDone(false);
      // 역할 화면들은 각자 상태를 들고 있다. 다시 실어야 같이 처음으로 간다.
      setFrameKey((n) => n + 1);
    } catch {
      // 발표 중 리셋이 실패해도 화면은 유지한다
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries();
    }
  }, [queryClient]);

  return (
    <div className="app">
      <div className="shell">
        <header className="topbar">
          <span className="topbar__title">
            <span className="topbar__name">ONCE Finance</span>
            <span className="topbar__tagline">
              같은 채권으로 두 번 대출받을 수 없다. 장부를 공유하지 않고
            </span>
          </span>
          <span className="topbar__status">
            <span className="topbar__item">
              체인 <b>{status?.network ?? EMPTY}</b>
            </span>
            <span className="topbar__item">
              {status?.simulated ? '순번' : '블록'}{' '}
              <b className="num">{status?.blockHeight ?? EMPTY}</b>
            </span>
            <span className="topbar__item">
              {status?.simulated ? '컨트랙트 (모의)' : '컨트랙트'}{' '}
              <b className="num">
                {status ? shortHash(`0x${status.contractAddress}`) : EMPTY}
              </b>
            </span>
            <span className="topbar__item">
              노드 <b>{status?.connected ? '연결됨' : '끊김'}</b>
            </span>
          </span>
        </header>

        <nav className="console-nav">
          <span className="console-nav__label">역할별 화면을 따로 연다</span>
          {ROLES.map((role) => (
            <a
              key={role.href}
              className="rolebar__link"
              href={role.href}
              target="_blank"
              rel="noreferrer"
            >
              {role.label}
            </a>
          ))}
        </nav>

        <div className="frames">
          {FRAMES.map((frame) => (
            <section className="frame" key={frame.href}>
              <iframe
                key={`${frame.href}-${frameKey}`}
                className="frame__view"
                src={frame.href}
                title={frame.label}
              />
            </section>
          ))}
        </div>

        {climaxDone ? (
          <p className="climax-note">한 건만 나갔다. B는 A의 장부를 보지 않았다.</p>
        ) : null}

        <section className="frame frame--wide">
          <iframe
            key={`ledger-${frameKey}`}
            className="frame__view frame__view--ledger"
            src="/ledger"
            title="공개 원장"
          />
        </section>

        <WalletPanel />

        <AttackPanel statuses={attacks} busy={busy} onRun={runAttack} onReset={reset} />
      </div>
    </div>
  );
}
