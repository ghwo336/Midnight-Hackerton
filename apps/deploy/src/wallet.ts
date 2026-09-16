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
  return createKeystore(keys[Roles.NightExternal], getNetworkId()).getBech32Address();
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

  const cfg = walletConfig(config) as never;
  const wallet = await WalletFacade.init({
    configuration: cfg,
    shielded: (c: never) => ShieldedWallet(c).startWithSecretKeys(shieldedSecretKeys),
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

export function nightBalance(state: { unshielded: { balances: Record<string, bigint> } }): bigint {
  return state.unshielded.balances[unshieldedToken().raw] ?? 0n;
}
