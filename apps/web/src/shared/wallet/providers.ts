'use client';

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexedDbPrivateStateProvider } from './private-state';
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
  readonly walletProvider: unknown;
  readonly midnightProvider: unknown;
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

  const rawZkConfig = new FetchZkConfigProvider<string>(
    new URL(ZK_BASE_URL, window.location.origin).toString(),
  );

  /*
   * 증명키 내려받기를 따로 잰다.
   *
   * 증명은 브라우저가 아니라 proof server 에서 일어난다. 클라이언트는
   * prover key 를 payload 에 실어 /prove 로 보낸다. finance 는 그 키가
   * 9.99MB 다. 그래서 "증명이 느리다"가 서버 탓인지 키 전송 탓인지를
   * 나누려면 이 구간이 따로 있어야 한다.
   */
  const zkConfigProvider = recorder
    ? (new Proxy(rawZkConfig, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          if (prop !== 'get' || typeof value !== 'function') return value;
          return (...args: unknown[]) =>
            recorder.time('zkConfig', () =>
              (value as (...a: unknown[]) => Promise<unknown>).apply(target, args),
            );
        },
      }) as FetchZkConfigProvider<string>)
    : rawZkConfig;

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
    privateStateProvider: indexedDbPrivateStateProvider(recorder),
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
