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
 * 진행 지점을 5분마다 저장한다. 완료 후에만 저장하면 중간에 끊겼을 때
 * 전부 날아간다.
 *
 * 끝나면 지갑 상태를 그대로 덤프한다. 추측한 키 경로로 잔액을 읽으려다
 * null 을 보고 "자금 없음" 으로 오해한 적이 있어서, 해석하지 않고 원본을
 * 남긴다.
 */
const config = useNetwork();
const seed = requireSeed();

const stamp = () => new Date().toISOString().slice(11, 19);
console.log(`\n[${stamp()}] network   ${config.name}`);
console.log(`[${stamp()}] address   ${unshieldedAddress(seed)}\n`);

const ctx = await buildWallet(seed, config);
const stopProgress = logSyncProgress(ctx.wallet);
const stopCheckpoint = checkpointSync(ctx, config);

try {
  await waitForSync(ctx.wallet);
  console.log(`\n[${stamp()}] 동기화 완료`);
} finally {
  stopProgress();
  stopCheckpoint();
  await persistSync(ctx, config, true);
}

const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.take(1)));
console.log(`\n[${stamp()}] 최종 상태:`);
console.log(
  JSON.stringify(state, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v), 2).slice(0, 4000),
);

await ctx.wallet.stop();
process.exit(0);
