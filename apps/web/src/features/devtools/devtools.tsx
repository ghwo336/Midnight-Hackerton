'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { EMPTY, shortHash } from '@/shared/ui/format';
import { visibleRunner } from '@/shared/runtime/devtool-visibility';
import { AttackPanel } from '@/features/attack-panel/attack-panel';
import { useAttackRunner } from '@/features/attack-panel/use-attack-runner';
import { OnChainAttacks } from '@/features/attack-panel/onchain-attacks';
import { IssuerKeyPanel } from './issuer-key-panel';
import { WalletPanel } from '@/features/wallet-panel/wallet-panel';
import { useWallet } from '@/features/wallet-panel/use-wallet';

/**
 * 검증 도구.
 *
 * **제품 기능이 아니다.** 배포·공격 재현·데모 초기화는 이 프로젝트가
 * 자기 주장을 확인하는 수단이지, 납품업체나 금융사가 쓰는 화면이 아니다.
 * 발표 콘솔에 같이 두면 심사위원이 어디까지가 제품이고 어디부터가 우리
 * 도구인지 구분할 수 없다.
 *
 * 진입은 푸터 링크뿐이다. 앱 안에 탭으로 두면 다시 제품의 일부로 읽힌다.
 */
export function DevTools() {
  const queryClient = useQueryClient();
  /*
   * 연결은 이 페이지가 하나만 들고 있다. 패널마다 따로 연결하면 사용자가
   * 같은 지갑을 두 번 승인해야 한다.
   */
  const wallet = useWallet('preprod');
  const attackRunner = useAttackRunner();

  const chain = useQuery({ queryKey: ['chain'], queryFn: api.chain });
  const invoices = useQuery({ queryKey: ['invoices'], queryFn: api.invoices });
  const status = chain.data;

  // 규칙은 visibleRunner 에 있고 테스트가 고정한다.
  const runner = visibleRunner(status?.simulated);

  return (
    <div className="app">
      <div className="shell">
        <header className="topbar">
          <span className="topbar__title">
            <span className="topbar__name">검증 도구</span>
            <span className="topbar__tagline">
              제품 화면이 아니다. 배포와 공격 재현에만 쓴다
            </span>
          </span>
          <span className="topbar__status">
            <span className="topbar__item">
              체인 <b>{status?.network ?? EMPTY}</b>
            </span>
            <span className="topbar__item">
              {runner === 'onchain' ? '블록' : '순번'}{' '}
              <b className="num">{status?.blockHeight ?? EMPTY}</b>
            </span>
            <span className="topbar__item">
              컨트랙트{' '}
              <b className="num">
                {status ? shortHash(`0x${status.contractAddress}`) : EMPTY}
              </b>
            </span>
          </span>
        </header>

        <WalletPanel wallet={wallet} />

        <IssuerKeyPanel />

        {/*
          실제 체인에서는 지갑이 서명해야 하므로 브라우저 러너를 쓴다.
          시뮬레이터에서는 서버가 서명하는 러너가 같은 시나리오를 훨씬
          빨리 돌린다. 둘을 동시에 보여줄 이유가 없다.
        */}
        {runner === 'onchain' ? (
          <OnChainAttacks
            wallet={wallet.state.api}
            contractAddress={status?.contractAddress ?? null}
            invoices={invoices.data ?? []}
            onDone={() => void queryClient.invalidateQueries()}
          />
        ) : null}

        {runner === 'simulator' ? (
          <AttackPanel
            statuses={attackRunner.attacks}
            busy={attackRunner.busy}
            onRun={(id) => void attackRunner.run(id)}
            onReset={() => void attackRunner.reset()}
          />
        ) : null}
      </div>
    </div>
  );
}
