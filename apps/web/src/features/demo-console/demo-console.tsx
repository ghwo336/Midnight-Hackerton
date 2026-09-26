'use client';

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/shared/api/client';
import { useLive } from '@/shared/role/use-live';
import { EMPTY, shortHash } from '@/shared/ui/format';
import { visibleRunner } from '@/shared/runtime/devtool-visibility';
import { AttackPanel } from '@/features/attack-panel/attack-panel';
import { useAttackRunner } from '@/features/attack-panel/use-attack-runner';
import { OnChainAttacks } from '@/features/attack-panel/onchain-attacks';
import { useWallet } from '@/features/wallet-panel/use-wallet';

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
 * **검증 도구는 대부분 여기 없다.** 배포 패널과 실제 체인 재현기는 제품
 * 기능이 아니라 우리가 주장을 확인하는 수단이라 /devtools 에 있다.
 *
 * 예외는 하단의 공격 줄이다. 발표는 "신청 → 지급 → 중복 차단 → 공격" 을
 * 한 화면에서 끊지 않고 보여줘야 하고, 화면을 전환하면 핵심 프레임(세 역할
 * + 원장)이 사라진다. 그래서 하단에 두고 "공격 시나리오" 라고 이름을 붙여
 * 제품 화면과 구분한다.
 *
 *   로컬       서버가 서명하는 시뮬레이터 러너 (A1~A6)
 *   실제 체인  지갑이 서명하는 재현기 (A5·A6) + 지갑 연결 한 줄.
 *              /devtools 와 같은 부품이고, 원본을 겨누면 확인 창이 뜬다
 *
 * 첫 화면은 세 역할 화면이 뷰포트 높이를 채우고, 아래로 스크롤하면 넓은
 * 공개 원장과 공격 줄이 나온다 (DESIGN §4). 역할 화면은 각자 안에서 스크롤한다.
 */

/**
 * 각 화면이 무엇을 보지 못하는지는 **여기에만** 적는다.
 *
 * 단독 화면(/supplier 등)은 그 역할이 실제로 쓰는 앱이어야 한다. 실제
 * 제품은 자기가 감추는 것을 설명하지 않는다. 그냥 없다. 설명을 화면 안에
 * 넣으면 제품이 아니라 데모 설명 화면이 된다.
 *
 * 콘솔은 발표·심사용이므로 여기서는 설명이 필요하다. iframe 바깥 래퍼에
 * 붙이므로 단독으로 열었을 때는 따라오지 않는다.
 */
const FRAMES: readonly { href: string; label: string; note: string }[] = [
  {
    href: '/supplier',
    label: '납품업체',
    note: '다른 금융사의 대출 내역과 공개 원장 전체가 이 화면에 없다',
  },
  {
    href: '/lender/lender-a',
    label: '금융사 A',
    note: '채권 원문을 받지 않는다. 금융사 B의 활동도 보이지 않는다',
  },
  {
    href: '/lender/lender-b',
    label: '금융사 B',
    note: '채권 원문을 받지 않는다. 금융사 A의 활동도 보이지 않는다',
  },
];

/**
 * 원장 칸은 "대출 기록" 표부터 보여준다. 체인 요약은 콘솔 상단바에 이미 있다.
 *
 * 주소 앵커(#loan-records)로는 안 됐다. 라우터가 하이드레이션 뒤 스크롤을
 * 맨 위로 돌려놓는다. React 의 onLoad 도 믿을 수 없다 — 서버가 그린 iframe 은
 * React 가 붙기 전에 로드를 끝내서 핸들러가 불리지 않는다. 그래서 마운트 때
 * 직접 확인하고, 이후 로드(새로고침)에도 다시 맞춘다. 같은 출처라 문서에 손댈
 * 수 있다. 역할 화면 코드는 건드리지 않는다.
 */
function useLoanRecordsScroll() {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const align = () => {
      const doc = frame.contentDocument;
      const target = doc?.getElementById('loan-records');
      const scroller = doc?.scrollingElement;
      if (target && scroller) scroller.scrollTop = target.offsetTop - 8;
    };
    const alignSoon = () => {
      for (const ms of [0, 300, 1000, 2500]) timers.push(setTimeout(align, ms));
    };
    alignSoon();
    frame.addEventListener('load', alignSoon);
    return () => {
      frame.removeEventListener('load', alignSoon);
      timers.forEach(clearTimeout);
    };
  }, []);
  return ref;
}

export function DemoConsole() {
  const chain = useQuery({ queryKey: ['chain'], queryFn: api.chain });
  // 콘솔은 단계 이벤트를 그리지 않는다. 연결을 붙들 이유가 없다.
  useLive('never');
  const attackRunner = useAttackRunner();
  const queryClient = useQueryClient();
  const wallet = useWallet('preprod');
  const invoices = useQuery({ queryKey: ['invoices'], queryFn: api.invoices });
  const ledgerFrame = useLoanRecordsScroll();

  const status = chain.data;

  return (
    <div className="app">
      <div className="shell shell--console">
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
              {/*
                연결 실패를 '끊김' 한 단어로 뭉개지 않는다. 요청이 무응답으로
                매달리면 화면은 값이 '—' 인 채 멈추고 아무 단서도 남지 않는다.
                무엇이 안 됐는지 그대로 적는다.
              */}
              노드{' '}
              <b className={chain.error ? 'topbar__fail' : ''}>
                {chain.error
                  ? chain.error instanceof ApiError
                    ? chain.error.message
                    : '연결 실패'
                  : status?.connected
                    ? '연결됨'
                    : '끊김'}
              </b>
            </span>
          </span>
        </header>

        <div className="frames">
          {FRAMES.map((frame) => (
            <section className="frame" key={frame.href}>
              {/*
                역할 이름은 iframe 안의 역할 표시줄이 이미 보여준다.
                여기서 또 쓰면 같은 이름이 두 줄로 겹친다. 설명만 얹는다.
              */}
              <header className="frame__cap">
                <span className="frame__note">{frame.note}</span>
              </header>
              <iframe className="frame__view" src={frame.href} title={frame.label} />
            </section>
          ))}
        </div>

        <section className="frame frame--wide">
          <header className="frame__cap">
            <span className="frame__note">이 표에 채권 내용은 한 글자도 없다</span>
          </header>
          <iframe
            className="frame__view frame__view--ledger"
            src="/ledger"
            title="공개 원장"
            ref={ledgerFrame}
          />
        </section>

        {visibleRunner(status?.simulated) === 'simulator' ? (
          <AttackPanel
            compact
            statuses={attackRunner.attacks}
            busy={attackRunner.busy}
            onRun={(id) => void attackRunner.run(id)}
            onReset={() => void attackRunner.reset()}
          />
        ) : null}

        {visibleRunner(status?.simulated) === 'onchain' ? (
          <>
            <section className="section section--walletbar">
              <header className="section__head">
                <span>지갑</span>
                <span className="walletbar__state">
                  {wallet.state.status === 'connected'
                    ? `연결됨 · ${wallet.state.address ? shortHash(wallet.state.address) : EMPTY}`
                    : wallet.state.status === 'failed'
                      ? (wallet.state.message ?? '연결 실패')
                      : '연결 안 됨'}
                  {wallet.state.status === 'connected' ? null : (
                    <button
                      type="button"
                      className="btn"
                      disabled={wallet.state.status === 'connecting'}
                      onClick={() => void wallet.connect()}
                    >
                      {wallet.state.status === 'connecting' ? '지갑 승인 대기 중' : '지갑 연결'}
                    </button>
                  )}
                </span>
              </header>
            </section>
            <OnChainAttacks
              wallet={wallet.state.api}
              contractAddress={status?.contractAddress ?? null}
              invoices={invoices.data ?? []}
              onDone={() => void queryClient.invalidateQueries()}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
