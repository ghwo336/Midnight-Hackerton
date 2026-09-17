'use client';

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexedDbPrivateStateProvider } from './private-state';

/**
 * 지갑이 알려준 설정으로 프로바이더를 구성한다.
 *
 * **엔드포인트를 하드코딩하지 않는다.** 스파이크에서 확인한 실제 값:
 *
 *   networkId:        'preprod'
 *   indexerUri:       'https://midnight-preprod.blockfrost.io/api/v0?project_id=...'
 *   proverServerUri:  'https://proof-server.preprod.midnight.network'
 *
 * 우리가 백엔드에서 쓰던 indexer.preprod.midnight.network가 아니라
 * Blockfrost 경유였고, proof server도 로컬 6300이 아니라 호스팅된 것이었다.
 * 지갑이 네트워크를 바꾸면 이 값들도 따라 바뀌므로 매번 읽어야 한다.
 */
export const ONCE_PRIVATE_STATE_ID = 'oncePrivateState';

/** ZK 자산은 우리가 정적으로 서빙한다 (public/zk → /zk). */
const ZK_BASE_URL = '/zk';

export interface OnceProviders {
  readonly privateStateProvider: ReturnType<typeof indexedDbPrivateStateProvider>;
  readonly publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
  readonly zkConfigProvider: FetchZkConfigProvider<string>;
  readonly proofProvider: ReturnType<typeof httpClientProofProvider>;
  readonly walletProvider: unknown;
  readonly midnightProvider: unknown;
}

export async function buildProviders(api: ConnectedAPI): Promise<OnceProviders> {
  const config = await api.getConfiguration();

  const zkConfigProvider = new FetchZkConfigProvider<string>(
    new URL(ZK_BASE_URL, window.location.origin).toString(),
  );

  // proverServerUri는 deprecated로 표시돼 있고 없을 수도 있다.
  // 없으면 지갑에 증명을 위임한다 (getProvingProvider).
  const proverUri = config.proverServerUri;

  /**
   * 잔액 조정과 제출은 지갑이 한다.
   *
   * 이것이 S6-d의 결론이고, 우리가 하루 종일 막혀 있던 지갑 동기화가
   * 브라우저 경로에 없는 이유다. 지갑이 자기 동기화 상태로 밸런싱한다.
   */
  const walletAndMidnight = {
    getCoinPublicKey: async () => (await api.getShieldedAddresses()).shieldedCoinPublicKey,
    getEncryptionPublicKey: async () =>
      (await api.getShieldedAddresses()).shieldedEncryptionPublicKey,
    balanceTx: async (tx: unknown) => {
      const { tx: balanced } = await api.balanceUnsealedTransaction(tx as never);
      return balanced as never;
    },
    submitTx: async (tx: unknown) => {
      await api.submitTransaction(tx as never);
      return undefined as never;
    },
  };

  return {
    privateStateProvider: indexedDbPrivateStateProvider(),
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(
      proverUri ?? 'https://proof-server.preprod.midnight.network',
      zkConfigProvider as never,
    ),
    walletProvider: walletAndMidnight,
    midnightProvider: walletAndMidnight,
  };
}
