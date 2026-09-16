import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { currentDir } from './config.js';

/**
 * 지갑 동기화 상태 캐시.
 *
 * 이게 없으면 실행할 때마다 Preprod 250만 블록을 처음부터 다시 간다.
 * 실제로 그렇게 26분을 돌렸고 CPU 4코어를 물고 있었다.
 *
 * ShieldedWallet은 serializeState()/restore()를 제공하고 restore 시그니처에
 * syncProgress가 들어 있어 이어서 동기화할 수 있다. 첫 1회만 무겁고
 * 그 뒤로는 증분이다.
 *
 * 캐시에는 지갑 상태가 들어가므로 커밋하지 않는다 (.gitignore의 .data/).
 */
const CACHE_PATH = resolve(currentDir, '..', '..', '..', '.data', 'wallet-sync.json');

export function loadSyncCache(networkName: string): unknown | null {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as {
      network?: string;
      state?: unknown;
    };
    if (raw.network !== networkName) return null;
    return raw.state ?? null;
  } catch {
    // 캐시가 깨졌으면 없는 셈 친다. 전체 동기화로 떨어질 뿐 틀린 상태를 쓰지 않는다.
    return null;
  }
}

export function saveSyncCache(networkName: string, state: unknown): void {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    writeFileSync(
      CACHE_PATH,
      `${JSON.stringify({ network: networkName, state, savedAt: new Date().toISOString() })}\n`,
    );
  } catch {
    // 캐시 저장 실패가 배포를 막으면 안 된다. 다음 실행이 느려질 뿐이다.
  }
}

export const syncCachePath = CACHE_PATH;
