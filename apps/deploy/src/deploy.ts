import { WebSocket } from 'ws';
// Node에서 GraphQL 구독(지갑 동기화)을 쓰려면 전역 WebSocket이 필요하다
globalThis.WebSocket = WebSocket as never;

import { deployContract } from '@midnight-ntwrk/midnight-js/contracts';
import { deriveIssuerPublicKey, deriveOwnerPublicKey, computeInvoiceLeaf } from '@once/crypto';
import { emptyPrivateState, issuerPrivateState } from '@once/chain';
import type { Hex } from '@once/domain';
import {
  ONCE_PRIVATE_STATE_ID, publicValue, requireSecret, requireSeed, useNetwork,
} from './config.js';
import {
  buildWallet, checkpointSync, logSyncProgress, nightBalance, persistSync,
  unshieldedAddress, waitForSync,
} from './wallet.js';
import { configureProviders } from './providers.js';
import { onceCompiledContract } from './contract.js';
import { hexToBytes } from '@once/domain';
import { writeFileSync } from 'node:fs';

const LTV_BPS = BigInt(process.env['LTV_BPS'] ?? '8000');

const LENDER_A = `0x${'0a'.repeat(32)}` as Hex;
const LENDER_B = `0x${'0b'.repeat(32)}` as Hex;
const LENDER_FUNDING = 1_000_000_000n;

const INVOICES = [100_000_000n, 50_000_000n, 250_000_000n];

interface TxPublic {
  readonly txId: string;
  readonly blockHeight: number;
  readonly contractAddress: string;
}

interface DeployedHandle {
  readonly deployTxData: { readonly public: TxPublic };
  readonly callTx: Record<string, ((...args: unknown[]) => Promise<{ public: TxPublic }>) | undefined>;
}

function stamp(label: string, startedAt: number): number {
  const ms = Date.now() - startedAt;
  console.log(`  ${label.padEnd(34)} ${String(ms).padStart(7)} ms`);
  return ms;
}

async function main(): Promise<void> {
  const config = useNetwork();
  const seed = requireSeed();

  // 비밀값은 기본값 없이 env에서만 온다 (config.ts의 requireSecret 주석 참조).
  // main() 안에서 읽어야 실패 시 스택 덤프 대신 한 줄 메시지가 나간다.
  const ISSUER_ID = publicValue('ISSUER_ID', `0x${'11'.repeat(32)}` as Hex);
  const ISSUER_SECRET = requireSecret('ISSUER_SECRET_KEY');
  const SUPPLIER_SECRET = requireSecret('SUPPLIER_SECRET_KEY');

  console.log(`\nnetwork   ${config.name}`);
  console.log(`indexer   ${config.indexer}`);
  console.log(`proof     ${config.proofServer}`);
  console.log(`address   ${unshieldedAddress(seed)}\n`);

  console.log('지갑 동기화 중...');
  const ctx = await buildWallet(seed, config);
  const stopProgress = logSyncProgress(ctx.wallet);
  // 2분마다 체크포인트.
  // 동기화는 진행에 비례해 메모리를 먹고 결국 OOM으로 죽는다(69%에서 6.65GB).
  // 재시작하면 힙이 초기화되므로, 자주 저장해 두고 감독 루프가 이어받는 전략이다.
  const stopCheckpoint = checkpointSync(ctx, config, 2 * 60_000);

  // 강제 종료(ctrl-c, stop-all.sh)에도 마지막 지점을 남긴다
  const onExit = () => {
    void persistSync(ctx, config, true).finally(() => process.exit(0));
  };
  process.once('SIGINT', onExit);
  process.once('SIGTERM', onExit);

  const state = await waitForSync(ctx.wallet);
  stopProgress();
  stopCheckpoint();
  await persistSync(ctx, config);
  const balance = nightBalance(state as never);
  console.log(`잔액      ${balance.toString()} tNight\n`);
  if (balance === 0n) {
    console.error('자금이 없다. faucet에서 tNight를 받고 다시 실행할 것:');
    console.error('  https://faucet.preprod.midnight.network/');
    process.exit(1);
  }

  const providers = await configureProviders(ctx, config);
  const timings: Record<string, number> = {};

  console.log('컨트랙트 배포 중 (증명 생성 포함)...');
  let t = Date.now();
  const deployed = await deployContract(providers as never, {
    compiledContract: onceCompiledContract as never,
    privateStateId: ONCE_PRIVATE_STATE_ID,
    initialPrivateState: issuerPrivateState(ISSUER_SECRET),
    args: [hexToBytes(ISSUER_ID), hexToBytes(deriveIssuerPublicKey(ISSUER_SECRET)), LTV_BPS],
  } as never);
  timings['deploy'] = stamp('deploy', t);

  const address = (deployed as unknown as DeployedHandle).deployTxData.public;
  console.log(`\n  contract  ${address.contractAddress}`);
  console.log(`  deploy tx ${address.txId}  (block ${address.blockHeight})\n`);

  const callTx = (deployed as unknown as DeployedHandle).callTx;
  const txs: { label: string; txId: string; block: number }[] = [
    { label: 'deploy', txId: address.txId, block: address.blockHeight },
  ];

  console.log('금융사 등록·예치...');
  for (const [name, key] of [['lender-a', LENDER_A], ['lender-b', LENDER_B]] as const) {
    t = Date.now();
    const r1 = await callTx['registerLender']?.(hexToBytes(key));
    timings[`registerLender:${name}`] = stamp(`registerLender ${name}`, t);
    if (r1) txs.push({ label: `registerLender:${name}`, txId: r1.public.txId, block: r1.public.blockHeight });

    t = Date.now();
    const r2 = await callTx['fundLender']?.(hexToBytes(key), LENDER_FUNDING);
    timings[`fundLender:${name}`] = stamp(`fundLender ${name}`, t);
    if (r2) txs.push({ label: `fundLender:${name}`, txId: r2.public.txId, block: r2.public.blockHeight });
  }

  console.log('채권 등록...');
  const ownerPk = deriveOwnerPublicKey(SUPPLIER_SECRET);
  const invoiceIds: Hex[] = [];
  for (let i = 0; i < INVOICES.length; i += 1) {
    const faceAmount = INVOICES[i] ?? 0n;
    const invoiceId = `0x${(i + 1).toString(16).padStart(2, '0').repeat(32)}` as Hex;
    invoiceIds.push(invoiceId);
    const leaf = computeInvoiceLeaf({ invoiceId, faceAmount, ownerPk });
    t = Date.now();
    const r = await callTx['registerInvoice']?.(hexToBytes(leaf));
    timings[`registerInvoice:${i + 1}`] = stamp(`registerInvoice #${i + 1}`, t);
    if (r) txs.push({ label: `registerInvoice:${i + 1}`, txId: r.public.txId, block: r.public.blockHeight });
  }

  const record = {
    network: config.name,
    contractAddress: address.contractAddress,
    issuerId: ISSUER_ID,
    ltvBps: LTV_BPS.toString(),
    invoices: invoiceIds.map((id, i) => ({ invoiceId: id, faceAmount: (INVOICES[i] ?? 0n).toString() })),
    lenders: { 'lender-a': LENDER_A, 'lender-b': LENDER_B },
    transactions: txs,
    timingsMs: timings,
    deployedAt: new Date().toISOString(),
  };
  writeFileSync(
    new URL('../deployment.json', import.meta.url),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  console.log('\ndeployment.json에 기록했다.');
  await ctx.wallet.stop();
  process.exit(0);
}

void main().catch((error: unknown) => {
  console.error('\n배포 실패:', error instanceof Error ? error.message : error);
  process.exit(1);
});
