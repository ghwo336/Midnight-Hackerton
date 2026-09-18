'use client';

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexedDbPrivateStateProvider } from './private-state';
import { createWalletBridge } from './wallet-bridge';
import type { Recorder } from './measure';
import { adoptNetworkId } from './network';

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
  readonly walletProvider: Awaited<ReturnType<typeof createWalletBridge>>;
  readonly midnightProvider: Awaited<ReturnType<typeof createWalletBridge>>;
}

export async function buildProviders(
  api: ConnectedAPI,
  /** 실측용. 없으면 계측하지 않는다. */
  recorder?: Recorder,
): Promise<OnceProviders> {
  const config = await api.getConfiguration();

  /*
   * 연결 시점에 이미 설정했지만 여기서 다시 보장한다.
   *
   * buildProviders는 모든 컨트랙트 연산 바로 앞에서 불린다. 연결 없이
   * 이 경로로 들어오거나 페이지가 다시 로드된 경우에도 전역이 비어 있지
   * 않게 하는 마지막 지점이다. 같은 값이면 아무 일도 하지 않는다.
   */
  adoptNetworkId(config.networkId);

  /*
   * 증명키 내려받기를 직접 계측한다.
   *
   * Proxy 로 감싸면 프로바이더가 클래스 메서드를 `this` 로 호출하는 경로가
   * 얽혀 원인을 좁히기 어려워진다. 대신 fetch 자체를 갈아끼운다. 요청 URL 과
   * 응답 상태가 남으므로 실패했을 때 무엇이 안 됐는지가 바로 보인다.
   */
  const zkConfigProvider = new FetchZkConfigProvider<string>(
    new URL(ZK_BASE_URL, window.location.origin).toString(),
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const started = performance.now();
      try {
        const response = await fetch(input, init);
        recorder?.note('zkConfig', performance.now() - started);
        if (!response.ok) {
          recorder?.fetchFailed(url, `HTTP ${response.status}`);
        }
        return response;
      } catch (cause: unknown) {
        recorder?.fetchFailed(url, cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    },
  );

  // proverServerUri는 deprecated로 표시돼 있고 없을 수도 있다.
  // 없으면 지갑에 증명을 위임한다 (getProvingProvider).
  const proverUri = config.proverServerUri;

  /*
   * 지갑이 잔액 조정·서명·제출을 한다. 이것이 브라우저 경로가 지갑
   * 동기화를 기다리지 않는 이유다 (S6-d).
   */
  const bridge = await createWalletBridge(api);

  return {
    privateStateProvider: indexedDbPrivateStateProvider(recorder),
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(
      proverUri ?? 'https://proof-server.preprod.midnight.network',
      zkConfigProvider as never,
    ),
    walletProvider: bridge,
    midnightProvider: bridge,
  };
}
