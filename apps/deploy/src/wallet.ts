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

/**
 * 동기화 진행을 주기적으로 찍는다.
 *
 * 이게 없으면 동기화가 블랙박스라, 몇 분 남았는지도 모르고 무작정 기다리게
 * 된다. 실제로 그렇게 26분을 돌리고도 끝을 못 봤다.
 * 진행률과 남은 시간 추정을 보여준다.
 */
export function logSyncProgress(wallet: WalletFacade, intervalMs = 15_000): () => void {
  const startedAt = Date.now();
  let last: { applied: number; at: number } | null = null;

  /** 진행 정보는 state.shielded.state.progress 에 있다 (구조 덤프로 확인). */
  const readProgress = (state: unknown): { applied: number; highest: number } | null => {
    const inner = (state as { shielded?: { state?: Record<string, unknown> } }).shielded?.state;
    const p = inner?.['progress'] as Record<string, unknown> | undefined;
    if (!p) return null;
    const applied = Number(p['appliedIndex'] ?? p['applied'] ?? NaN);
    // 목표값은 highestRelevantWalletIndex다. highestIndex는 0으로 남는다
    // (실측: applied 2974 / relevantWallet 1529726 / highest 0).
    const candidates = [
      p['highestRelevantWalletIndex'],
      p['highestRelevantIndex'],
      p['highestIndex'],
      p['highest'],
    ].map(Number).filter((n) => Number.isFinite(n) && n > 0);
    const highest = candidates[0] ?? NaN;
    return Number.isFinite(applied) && Number.isFinite(highest) ? { applied, highest } : null;
  };

  let dumped = false;
  const sub = wallet.state().subscribe((state) => {
    const now = Date.now();

    // 첫 상태에서 구조를 한 번 찍는다. 진행률 필드명을 추측으로 짚다가
    // 두 번 틀렸다. 실제 키를 보고 맞춘다.
    if (!dumped) {
      dumped = true;
      const sh = (state as { shielded?: object }).shielded;
      console.log('  [구조] state keys:', Object.keys(state as object).join(', '));
      if (sh) {
        console.log('  [구조] shielded keys:', Object.keys(sh).join(', '));
        const inner = (sh as { state?: Record<string, unknown> }).state;
        const prog = inner?.['progress'];
        if (prog && typeof prog === 'object') {
          console.log('  [구조] progress:', JSON.stringify(prog, (_k, v) =>
            typeof v === 'bigint' ? String(v) : v));
        }
      }
    }

    if (last && now - last.at < intervalMs) return;

    const p = readProgress(state);
    const mins = ((now - startedAt) / 60_000).toFixed(1);

    if (!p || p.highest <= 0) {
      // 퍼센트를 못 내더라도 원시값은 찍는다. "진행 지표 없음"만 반복하면
      // 밤새 돌려놓고도 전진하는지 멈춰 있는지 알 수 없다.
      const inner = (state as { shielded?: { state?: Record<string, unknown> } }).shielded?.state;
      const raw = inner?.['progress'];
      console.log(
        `  [${mins}분] ${JSON.stringify(raw, (_k, v) => (typeof v === 'bigint' ? String(v) : v))}`,
      );
      last = { applied: p?.applied ?? 0, at: now };
      return;
    }

    const pct = ((p.applied / p.highest) * 100).toFixed(2);

    // ETA는 **누적 평균**으로 낸다. 직전 구간 속도만 쓰면 블록 밀도에 따라
    // 122분 → 32분 → 263분으로 요동쳐 밤새 지켜볼 지표가 못 된다.
    let eta = '';
    const elapsedSec = (now - startedAt) / 1000;
    if (elapsedSec > 10 && p.applied > 0) {
      const avgRate = p.applied / elapsedSec;
      const remainMin = (p.highest - p.applied) / avgRate / 60;
      eta = ` · 남은 시간 약 ${remainMin.toFixed(0)}분 (평균 ${Math.round(avgRate)}/s)`;
    }
    console.log(
      `  [${mins}분] ${pct}%  ${p.applied.toLocaleString()} / ${p.highest.toLocaleString()}${eta}`,
    );
    last = { applied: p.applied, at: now };
  });

  return () => sub.unsubscribe();
}

export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));

/**
 * 동기화 지점을 **주기적으로** 저장한다.
 *
 * 완료 후에만 저장하면 밤새 돌리다 끊겼을 때 전부 날아간다. 실제로 네 번
 * 시도해서 한 번도 완료하지 못했으므로, 중간 저장이 없으면 진전이 0이다.
 *
 * 반환값을 호출해 멈춘다.
 */
export function checkpointSync(
  ctx: WalletContext,
  config: NetworkConfig,
  intervalMs = 5 * 60_000,
): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    void persistSync(ctx, config, true);
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * 동기화 지점을 저장한다. 다음 실행이 여기서부터 이어간다.
 * 실패해도 배포를 막지 않는다 — 다음 실행이 느려질 뿐이다.
 */
export async function persistSync(
  ctx: WalletContext,
  config: NetworkConfig,
  quiet = false,
): Promise<void> {
  const shielded = (ctx.wallet as unknown as {
    shielded?: { serializeState?: () => Promise<unknown> };
  }).shielded;
  if (!shielded?.serializeState) return;
  try {
    saveSyncCache(config.name, await shielded.serializeState());
    console.log(
      quiet
        ? `  체크포인트 저장됨 (${new Date().toLocaleTimeString('ko-KR')})`
        : '동기화 지점을 저장했다. 다음 실행은 증분 동기화다.',
    );
  } catch {
    // 저장 실패가 동기화를 막으면 안 된다
  }
}

export function nightBalance(state: { unshielded: { balances: Record<string, bigint> } }): bigint {
  return state.unshielded.balances[unshieldedToken().raw] ?? 0n;
}
