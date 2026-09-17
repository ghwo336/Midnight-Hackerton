'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import {
  connectWallet, describeFailure, detectWallets,
  type DetectedWallet, type NetworkId,
} from '@/shared/wallet/connect';

export interface WalletState {
  readonly status: 'idle' | 'connecting' | 'connected' | 'failed';
  readonly api: ConnectedAPI | null;
  readonly wallet: DetectedWallet | null;
  readonly address: string | null;
  readonly balance: string | null;
  readonly network: string | null;
  readonly message: string | null;
}

const INITIAL: WalletState = {
  status: 'idle', api: null, wallet: null,
  address: null, balance: null, network: null, message: null,
};

/** 네이티브 토큰(tNight)의 토큰 타입. 32바이트 0. */
const NATIVE = '0'.repeat(64);

export function useWallet(networkId: NetworkId = 'preprod') {
  const [state, setState] = useState<WalletState>(INITIAL);

  /**
   * 지갑 감지는 렌더가 아니라 effect에서 한다.
   *
   * detectWallets()를 렌더 중에 부르면 서버(window 없음)와 클라이언트
   * (지갑 있음)의 결과가 달라 하이드레이션이 깨진다. 서버는 항상
   * "지갑 없음"으로 렌더하고, 마운트 후에 실제 값으로 바꾼다.
   */
  const [hasWallet, setHasWallet] = useState(false);
  useEffect(() => {
    setHasWallet(detectWallets().length > 0);
  }, []);

  const connect = useCallback(async () => {
    setState((p) => ({ ...p, status: 'connecting', message: null }));

    const result = await connectWallet(networkId);
    if (!result.ok) {
      setState({ ...INITIAL, status: 'failed', message: describeFailure(result.failure) });
      return;
    }

    const { api, wallet } = result;
    try {
      const [config, unshielded, balances] = await Promise.all([
        api.getConfiguration(),
        api.getUnshieldedAddress(),
        api.getUnshieldedBalances(),
      ]);
      const raw = balances[NATIVE];
      setState({
        status: 'connected',
        api,
        wallet,
        address: unshielded.unshieldedAddress,
        balance: raw === undefined ? '0' : raw.toString(),
        network: config.networkId,
        message: null,
      });
    } catch (error: unknown) {
      setState({
        ...INITIAL,
        status: 'failed',
        message: `지갑 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [networkId]);

  const disconnect = useCallback(() => setState(INITIAL), []);

  return { state, connect, disconnect, hasWallet };
}
