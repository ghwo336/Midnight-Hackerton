import { WebSocket } from 'ws';
globalThis.WebSocket = WebSocket as never;

import * as Rx from 'rxjs';
import { requireSeed, useNetwork } from './config.js';
import {
  buildWallet, checkpointSync, logSyncProgress, persistSync, unshieldedAddress, waitForSync,
} from './wallet.js';

/**
 * 지갑을 끝까지 동기화하고 멈춘다. **트랜잭션을 내지 않는다.**
 *
 * 시나리오 실행(`scenario`)과 분리한 이유는 하나다. 동기화는 몇 시간이
 * 걸리고, 그 끝에서 곧바로 A5·A6 이 실제 네트워크에 트랜잭션을 낸다면
 * 사람이 보지 않는 사이에 되돌릴 수 없는 일이 일어난다. 채권의 중복
 * 확인값은 한 번 등록되면 영구히 남는다. 그래서 여기서는 동기화만 한다.
 *
 * ## 메모리
 *
 * DUST 동기화는 힙을 계속 키운다. 실측: 12분 동안 6.8GB 까지 올라가
 * `--max-old-space-size=8192` 에 걸려 OOM 으로 죽었다 (exit 134). 이 머신은
 * 물리 메모리가 16GB 라 상한을 더 올리면 스왑으로 넘어간다.
 *
 * 그래서 **죽기 전에 스스로 나간다.** 힙이 임계치를 넘으면 진행 지점을
 * 저장하고 EXIT_MEMORY 로 종료한다. 감시 스크립트가 그걸 보고 새 프로세스로
 * 이어받는다. 크래시로 죽으면 `finally` 가 돌지 않아 마지막 체크포인트
 * 이후의 진전이 통째로 날아가는데, 이렇게 하면 나가기 직전 지점까지 남는다.
 */

/** 감시 스크립트가 "메모리 때문에 자발적으로 나갔다" 를 구분하는 코드. */
export const EXIT_MEMORY = 17;

/** 이 선을 넘으면 저장하고 나간다. 8GB 상한에 닿기 전에 여유를 둔다. */
const HEAP_LIMIT_BYTES = 5.5 * 1024 * 1024 * 1024;

/** 체크포인트 간격. 짧을수록 한 번 끊겼을 때 잃는 구간이 작다. */
const CHECKPOINT_MS = 2 * 60_000;

const config = useNetwork();
const seed = requireSeed();

/*
 * 로컬 시각으로 찍는다. UTC 로 찍었더니 감시 스크립트의 `date` 출력과
 * 아홉 시간 어긋나서, 같은 로그 안의 두 시각이 다른 사건처럼 보였다.
 */
const stamp = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
console.log(`\n[${stamp()}] network   ${config.name}`);
console.log(`[${stamp()}] address   ${unshieldedAddress(seed)}\n`);

const ctx = await buildWallet(seed, config);
const stopProgress = logSyncProgress(ctx.wallet);
const stopCheckpoint = checkpointSync(ctx, config, CHECKPOINT_MS);

/**
 * 힙 감시. 임계치를 넘으면 저장하고 나간다.
 *
 * OOM 을 기다리지 않는 이유는 그때 `finally` 가 돌지 않기 때문이다.
 * 저장 없이 죽으면 마지막 체크포인트 이후가 전부 날아간다.
 */
const heapWatch = setInterval(() => {
  const used = process.memoryUsage().heapUsed;
  if (used < HEAP_LIMIT_BYTES) return;
  clearInterval(heapWatch);
  stopProgress();
  stopCheckpoint();
  const gb = (used / 1024 / 1024 / 1024).toFixed(2);
  console.log(`\n[${stamp()}] 힙 ${gb}GB — 저장하고 넘긴다 (감시자가 이어받는다)`);
  void persistSync(ctx, config, true)
    .catch(() => undefined)
    .then(() => process.exit(EXIT_MEMORY));
}, 15_000);

try {
  await waitForSync(ctx.wallet);
  clearInterval(heapWatch);
  console.log(`\n[${stamp()}] 동기화 완료`);
} finally {
  stopProgress();
  stopCheckpoint();
  clearInterval(heapWatch);
  await persistSync(ctx, config, true).catch(() => undefined);
}

const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.take(1)));
console.log(`\n[${stamp()}] 최종 상태:`);
console.log(
  JSON.stringify(state, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v), 2).slice(0, 4000),
);

await ctx.wallet.stop();
process.exit(0);
