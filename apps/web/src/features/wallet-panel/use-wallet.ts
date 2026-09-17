'use client';

import { useCallback, useState } from 'react';
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

  return { state, connect, disconnect, hasWallet: detectWallets().length > 0 };
}
