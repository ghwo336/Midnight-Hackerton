import { Buffer } from 'node:buffer';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import * as Rx from 'rxjs';
import type { NetworkConfig } from './config.js';
import { loadSyncCache, saveSyncCache } from './sync-cache.js';

export interface WalletContext {
  readonly wallet: WalletFacade;
  readonly shieldedSecretKeys: ledger.ZswapSecretKeys;
  readonly dustSecretKey: ledger.DustSecretKey;
  readonly unshieldedKeystore: UnshieldedKeystore;
}

/** 시드에서 세 역할(Zswap, NightExternal, Dust)의 키를 유도한다. */
export function deriveKeys(seed: string) {
  const hd = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hd.type !== 'seedOk') throw new Error('failed to initialise HD wallet from seed');

  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derived.type !== 'keysDerived') throw new Error('failed to derive keys');
  hd.hdWallet.clear();
  return derived.keys;
}

/** 자금을 받을 unshielded 주소. faucet에 넣는 값이다. */
export function unshieldedAddress(seed: string): string {
  const keys = deriveKeys(seed);
  return String(createKeystore(keys[Roles.NightExternal], getNetworkId()).getBech32Address());
}

/**
 * WalletFacade는 세 하위 지갑(shielded/unshielded/dust)의 설정을 하나로 받는다.
 * 키 이름과 구조는 공식 counter 예제를 따른다.
 */
function walletConfig(config: NetworkConfig) {
  const indexerClientConnection = {
    indexerHttpUrl: config.indexer,
    indexerWsUrl: config.indexerWS,
  };
  const provingServerUrl = new URL(config.proofServer);
  const relayURL = new URL(config.node.replace(/^http/, 'ws'));

  return {
    networkId: getNetworkId(),
    indexerClientConnection,
    provingServerUrl,
    relayURL,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
  };
}

export async function buildWallet(seed: string, config: NetworkConfig): Promise<WalletContext> {
  const keys = deriveKeys(seed);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

  // 이전 실행의 동기화 지점에서 이어서 시작한다. 없으면 전체 동기화.
  const cached = loadSyncCache(config.name);
  if (cached) console.log('동기화 캐시 사용 — 마지막 지점부터 이어서 갑니다');
  else console.log('동기화 캐시 없음 — 전체 동기화 (첫 1회, 오래 걸립니다)');

  const cfg = walletConfig(config) as never;
  const wallet = await WalletFacade.init({
    configuration: cfg,
    shielded: (c: never) => {
      const builder = ShieldedWallet(c) as unknown as {
        restore?: (state: unknown) => unknown;
        startWithSecretKeys: (k: typeof shieldedSecretKeys) => unknown;
      };
      if (cached && typeof builder.restore === 'function') {
        try {
          return builder.restore(cached) as never;
        } catch {
          // 캐시가 현재 SDK/네트워크와 안 맞으면 전체 동기화로 떨어진다
        }
      }
      return builder.startWithSecretKeys(shieldedSecretKeys) as never;
    },
    unshielded: (c: never) =>
      UnshieldedWallet(c).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (c: never) =>
      DustWallet(c).startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust,
      ),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}

export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));

/**
 * 동기화 지점을 저장한다. 다음 실행이 여기서부터 이어간다.
 * 실패해도 배포를 막지 않는다 — 다음 실행이 느려질 뿐이다.
 */
export async function persistSync(
  ctx: WalletContext,
  config: NetworkConfig,
): Promise<void> {
  const shielded = (ctx.wallet as unknown as {
    shielded?: { serializeState?: () => Promise<unknown> };
  }).shielded;
  if (!shielded?.serializeState) return;
  try {
    saveSyncCache(config.name, await shielded.serializeState());
    console.log('동기화 지점을 저장했다. 다음 실행은 증분 동기화다.');
  } catch {
    // 무시
  }
}

export function nightBalance(state: { unshielded: { balances: Record<string, bigint> } }): bigint {
  return state.unshielded.balances[unshieldedToken().raw] ?? 0n;
}
