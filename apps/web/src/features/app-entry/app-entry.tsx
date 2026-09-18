'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { RoleKind } from '@/shared/api/types';
import { readIssuerPublicKey } from '@/shared/wallet/private-state';
import { useWallet } from '@/features/wallet-panel/use-wallet';
import { SupplierApp } from '@/features/supplier-app/supplier-app';
import { LenderApp } from '@/features/lender-app/lender-app';
import { IssuerApp } from '@/features/issuer-app/issuer-app';
import { ConnectGate } from './connect-gate';
import { RoleClaim } from './role-claim';
import { AppFooter } from './app-footer';

/**
 * 앱 진입점.
 *
 * 역할을 고르게 하지 않는다. 접속한 지갑이 무엇을 할 수 있는지 보고
 * 그 화면으로 바로 들어간다.
 *
 * 판별 순서:
 *   1. 이 기기가 발급 기관 키를 쥐고 있는가 — 원장의 issuerPk 와 대조한다.
 *      서버에 묻지 않는다. 비밀키는 브라우저에만 있고 서버는 모른다.
 *   2. 이 주소 앞으로 발행된 채권이 있는가 → 자금 조달
 *   3. 등록된 금융사 주소인가 → 여신 심사
 *   4. 해당 없음 → 시작하기
 */
export function AppEntry() {
  const queryClient = useQueryClient();
  const { state, connect, disconnect, hasWallet } = useWallet('preprod');
  const [active, setActive] = useState<RoleKind | null>(null);

  const address = state.address;

  const identity = useQuery({
    queryKey: ['identity', address],
    queryFn: () => api.identity(address ?? ''),
    enabled: address !== null,
  });

  const issuerState = useQuery({
    queryKey: ['issuer'],
    queryFn: api.issuer,
    enabled: address !== null,
  });

  /*
   * 발급 권한은 키 소유로 정해진다.
   *
   * 이 기기에 저장된 발급 기관 공개키가 원장의 issuerPk 와 같으면 발급
   * 기관이다. 회로가 issuerPublicKey(issuerSecret()) == issuerPk 를 assert
   * 하므로, 같다는 것은 이 기기의 비밀키로 발급 회로를 부를 수 있다는 뜻이다.
   */
  const [holdsIssuerKey, setHoldsIssuerKey] = useState(false);
  useEffect(() => {
    const chainPk = issuerState.data?.issuerPk;
    if (!chainPk) return;
    let alive = true;
    void readIssuerPublicKey().then((mine) => {
      if (alive) setHoldsIssuerKey(mine !== null && mine.toLowerCase() === chainPk.toLowerCase());
    });
    return () => {
      alive = false;
    };
  }, [issuerState.data?.issuerPk]);

  const roles: RoleKind[] = [
    ...(holdsIssuerKey ? (['issuer'] as const) : []),
    ...(identity.data?.roles ?? []),
  ];

  // 판별 순서대로 첫 역할을 고른다. 사용자가 고른 적 있으면 그걸 유지한다.
  const resolved: RoleKind | null =
    active !== null && roles.includes(active) ? active : (roles[0] ?? null);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['identity'] });
  }, [queryClient]);

  const account = address === null
    ? undefined
    : {
        address,
        roles,
        active: resolved ?? ('supplier' as RoleKind),
        onSwitch: setActive,
        onDisconnect: disconnect,
      };

  if (state.status !== 'connected' || address === null) {
    return (
      <div className="app-shell">
        <ConnectGate
          connecting={state.status === 'connecting'}
          message={state.message}
          hasWallet={hasWallet}
          onConnect={() => void connect()}
        />
        <AppFooter />
      </div>
    );
  }

  if (identity.isLoading || issuerState.isLoading) {
    return (
      <div className="app-shell">
        <div className="gate">
          <div className="gate__box">
            <p className="hint">계정을 확인하는 중</p>
          </div>
        </div>
        <AppFooter />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {resolved === 'issuer' ? (
        <IssuerApp account={account} />
      ) : resolved === 'lender' && identity.data?.lenderId ? (
        <LenderApp lenderId={identity.data.lenderId} account={account} />
      ) : resolved === 'supplier' ? (
        <SupplierApp account={account} wallet={state.api} />
      ) : (
        <RoleClaim address={address} onClaimed={refresh} onDisconnect={disconnect} />
      )}
      <AppFooter />
    </div>
  );
}
