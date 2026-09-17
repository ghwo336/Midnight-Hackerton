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
  if (cached) {
    const has = (['shielded', 'dust', 'unshielded'] as const)
      .filter((k) => cached[k] != null)
      .join(', ');
    console.log(`동기화 캐시 사용: ${has || '(비어 있음)'}`);
  } else {
    console.log('동기화 캐시 없음. 전체 동기화 (첫 1회, 오래 걸립니다)');
  }

  /**
   * 캐시가 있으면 restore, 없으면 새로 시작한다.
   *
   * shielded만 저장했더니 dust/unshielded가 매 회차 처음부터 다시 동기화하며
   * 같은 메모리 벽에 부딪혀 OOM을 반복했다(회차 3~5). 셋 다 복원해야 전진한다.
   */
  const startOrRestore = <B, R>(builder: B, key: 'shielded' | 'dust' | 'unshielded', fresh: (b: B) => R): R => {
    const saved = cached?.[key];
    if (saved != null) {
      const withRestore = builder as unknown as { restore?: (state: unknown) => R };
      if (typeof withRestore.restore === 'function') {
        try {
          return withRestore.restore(saved);
        } catch {
          // 캐시가 현재 SDK/네트워크와 안 맞으면 전체 동기화로 떨어진다
        }
      }
    }
    return fresh(builder);
  };

  const cfg = walletConfig(config) as never;
  const wallet = await WalletFacade.init({
    configuration: cfg,
    shielded: (c: never) =>
      startOrRestore(ShieldedWallet(c), 'shielded', (b) =>
        b.startWithSecretKeys(shieldedSecretKeys)) as never,
    unshielded: (c: never) =>
      startOrRestore(UnshieldedWallet(c), 'unshielded', (b) =>
        b.startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore))) as never,
    dust: (c: never) =>
      startOrRestore(DustWallet(c), 'dust', (b) =>
        b.startWithSecretKey(
          dustSecretKey,
          ledger.LedgerParameters.initialParameters().dust,
        )) as never,
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
  /** 이번 실행의 시작 인덱스. 캐시에서 재개하면 0이 아니다. */
  let baseApplied: number | null = null;
  /** 최근 표본 창. 누적 평균은 구간 속도 변화를 못 따라간다. */
  const window: { applied: number; at: number }[] = [];
  const WINDOW = 8;

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

    // isSynced는 세 지갑(shielded/dust/unshielded)이 모두 완료돼야 true다.
    // shielded만 보면 100%에서 멈춘 것처럼 보인다. 나머지 둘도 같이 찍는다.
    const done = (node: unknown): string => {
      const prog = (node as { progress?: { isStrictlyComplete?: () => boolean } })?.progress
        ?? (node as { state?: { progress?: { isStrictlyComplete?: () => boolean } } })?.state?.progress;
      try {
        return prog?.isStrictlyComplete?.() ? '완료' : '진행';
      } catch {
        return '?';
      }
    };
    const st = state as { shielded?: unknown; dust?: unknown; unshielded?: unknown };
    const others = ` [shielded ${done(st.shielded)} · dust ${done(st.dust)} · unshielded ${done(st.unshielded)}]`;

    // ETA는 **누적 평균**으로 낸다. 직전 구간 속도만 쓰면 블록 밀도에 따라
    // 122분 → 32분 → 263분으로 요동쳐 밤새 지켜볼 지표가 못 된다.
    // 재개분을 이번 실행의 처리량으로 세면 안 된다. 캐시에서 68,804부터
    // 시작했는데 그걸 포함해 평균을 내면 "남은 시간 4분" 같은 값이 나온다.
    if (baseApplied === null) baseApplied = p.applied;

    // ETA는 **최근 표본 창**으로 낸다.
    // 누적 평균은 초반 고속 구간(6000/s)에 끌려가서, 밀집 구간(200/s)에
    // 들어선 뒤에도 "남은 시간 3분"이라고 거짓말한다. 블록 밀도가 구간마다
    // 다르므로 최근 속도가 남은 시간을 더 잘 설명한다.
    window.push({ applied: p.applied, at: now });
    if (window.length > WINDOW) window.shift();

    let eta = '';
    const first = window[0];
    if (first && window.length >= 2 && p.applied > first.applied) {
      const rate = (p.applied - first.applied) / ((now - first.at) / 1000);
      if (rate > 0) {
        const remainMin = (p.highest - p.applied) / rate / 60;
        eta = ` · 남은 시간 약 ${remainMin.toFixed(0)}분 (최근 ${Math.round(rate)}/s)`;
      }
    }
    console.log(
      `  [${mins}분] ${pct}%  ${p.applied.toLocaleString()} / ${p.highest.toLocaleString()}${eta}${others}`,
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
 * 실패해도 배포를 막지 않는다. 다음 실행이 느려질 뿐이다.
 */
export async function persistSync(
  ctx: WalletContext,
  config: NetworkConfig,
  quiet = false,
): Promise<void> {
  const w = ctx.wallet as unknown as Record<
    'shielded' | 'dust' | 'unshielded',
    { serializeState?: () => Promise<unknown> } | undefined
  >;
  const grab = async (k: 'shielded' | 'dust' | 'unshielded') => {
    try {
      return await w[k]?.serializeState?.();
    } catch {
      return undefined;
    }
  };
  try {
    saveSyncCache(config.name, {
      shielded: await grab('shielded'),
      dust: await grab('dust'),
      unshielded: await grab('unshielded'),
    });
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
