import { WebSocket } from 'ws';
globalThis.WebSocket = WebSocket as never;

import { readFileSync, writeFileSync } from 'node:fs';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { computeNullifier, deriveOwnerPublicKey } from '@once/crypto';
import { hexToBytes, type Hex } from '@once/domain';
import { withActiveInvoice, emptyPrivateState } from '@once/chain';
import {
  ONCE_PRIVATE_STATE_ID, publicValue, requireSecret, requireSeed, useNetwork,
} from './config.js';
import { buildWallet, logSyncProgress, persistSync, waitForSync } from './wallet.js';
import { configureProviders } from './providers.js';
import { onceCompiledContract } from './contract.js';

/**
 * A5·A6을 **테스트넷에서** 재현한다.
 *
 * 로컬 시뮬레이터는 제출 큐로 직렬화를 모델링했다. 실제 합의에서도 하나만
 * 확정되는지는 여기서만 증명된다. 그게 제품의 핵심 주장이다.
 *
 * 각 단계의 tx 해시와 소요 시간을 기록해 docs/TEST_REPORT.md에 옮긴다.
 */

interface Deployment {
  network: string;
  contractAddress: string;
  issuerId: Hex;
  invoices: { invoiceId: Hex; faceAmount: string }[];
  lenders: Record<string, Hex>;
}

interface StepRecord {
  step: string;
  outcome: 'settled' | 'rejected';
  txId: string | null;
  block: number | null;
  ms: number;
  detail: string;
}

const SUPPLIER_ADDRESS = `0x${'cc'.repeat(32)}` as Hex;

function loadDeployment(): Deployment {
  try {
    return JSON.parse(
      readFileSync(new URL('../deployment.json', import.meta.url), 'utf8'),
    ) as Deployment;
  } catch {
    throw new Error(
      'deployment.json이 없다. 먼저 pnpm --filter @once/deploy deploy 를 실행할 것.',
    );
  }
}

async function main(): Promise<void> {
  const config = useNetwork();
  const seed = requireSeed();
  const issuerSecret = requireSecret('ISSUER_SECRET_KEY');
  const supplierSecret = requireSecret('SUPPLIER_SECRET_KEY');
  void publicValue;

  const deployment = loadDeployment();
  console.log(`\nnetwork    ${deployment.network}`);
  console.log(`contract   ${deployment.contractAddress}\n`);

  console.log('지갑 동기화 중 (캐시가 있으면 증분)...');
  const ctx = await buildWallet(seed, config);
  const stopProgress = logSyncProgress(ctx.wallet);
  await waitForSync(ctx.wallet);
  stopProgress();
  await persistSync(ctx, config, true);

  const providers = await configureProviders(ctx, config);
  const ownerPk = deriveOwnerPublicKey(supplierSecret);
  void ownerPk;
  void issuerSecret;

  const results: StepRecord[] = [];

  /** 같은 컨트랙트에 붙되, 신청마다 비공개 상태(채권 원문)를 바꿔 끼운다. */
  const attach = async (invoiceIndex: number) => {
    const invoice = deployment.invoices[invoiceIndex];
    if (!invoice) throw new Error('deployment.json에 해당 채권이 없다');
    const privateState = withActiveInvoice(emptyPrivateState(), {
      invoiceId: invoice.invoiceId,
      faceAmount: BigInt(invoice.faceAmount),
      salt: `0x${'d1'.repeat(32)}` as Hex,
      ownerSecret: supplierSecret,
    });
    return findDeployedContract(providers as never, {
      contractAddress: deployment.contractAddress,
      compiledContract: onceCompiledContract as never,
      privateStateId: ONCE_PRIVATE_STATE_ID,
      initialPrivateState: privateState,
    } as never);
  };

  const finance = async (
    step: string,
    invoiceIndex: number,
    lender: 'lender-a' | 'lender-b',
  ): Promise<StepRecord> => {
    const invoice = deployment.invoices[invoiceIndex];
    if (!invoice) throw new Error('채권 없음');
    const amount = (BigInt(invoice.faceAmount) * 8000n) / 10_000n;
    const started = Date.now();
    try {
      const contract = await attach(invoiceIndex);
      const callTx = (contract as unknown as {
        callTx: Record<string, (...a: unknown[]) => Promise<{ public: { txId: string; blockHeight: number } }>>;
      }).callTx;
      const r = await callTx['finance']?.(
        hexToBytes(deployment.lenders[lender] as Hex),
        amount,
        { bytes: hexToBytes(SUPPLIER_ADDRESS) },
      );
      return {
        step, outcome: 'settled',
        txId: r?.public.txId ?? null,
        block: r?.public.blockHeight ?? null,
        ms: Date.now() - started,
        detail: `${lender} · ${amount.toString()}`,
      };
    } catch (error: unknown) {
      return {
        step, outcome: 'rejected', txId: null, block: null,
        ms: Date.now() - started,
        detail: error instanceof Error ? error.message.slice(0, 160) : String(error),
      };
    }
  };

  const show = (r: StepRecord) => {
    console.log(
      `  ${r.step.padEnd(28)} ${r.outcome === 'settled' ? '확정' : '거부'}  ` +
        `${String(r.ms).padStart(7)} ms  ${r.txId ? r.txId.slice(0, 18) + '…' : '—'}`,
    );
    if (r.outcome === 'rejected') console.log(`    └ ${r.detail}`);
    results.push(r);
  };

  // ── A5: 같은 채권으로 두 금융사에 동시 신청 ──
  console.log('\nA5: 두 금융사에 동시 신청 (채권 #2)');
  const a5 = await Promise.all([
    finance('A5 lender-a', 1, 'lender-a'),
    finance('A5 lender-b', 1, 'lender-b'),
  ]);
  a5.forEach(show);
  const settledCount = a5.filter((r) => r.outcome === 'settled').length;
  console.log(`  → 확정 ${settledCount}건 (기대: 1건)`);

  // ── A6: 미사용 시점에 준비한 신청을 사용 후에 제출 ──
  console.log('\nA6: 지연 제출 (채권 #3)');
  const nf = computeNullifier(deployment.issuerId, deployment.invoices[2]?.invoiceId as Hex);
  console.log(`  대상 nullifier ${nf.slice(0, 18)}…`);
  show(await finance('A6 셋업 (lender-a)', 2, 'lender-a'));
  show(await finance('A6 지연 제출 (lender-b)', 2, 'lender-b'));

  const record = {
    network: deployment.network,
    contractAddress: deployment.contractAddress,
    ranAt: new Date().toISOString(),
    a5SettledCount: settledCount,
    steps: results,
  };
  writeFileSync(
    new URL('../scenario-result.json', import.meta.url),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  console.log('\nscenario-result.json에 기록했다.');
  await ctx.wallet.stop();
  process.exit(0);
}

void main().catch((error: unknown) => {
  console.error('\n시나리오 실패:', error instanceof Error ? error.message : error);
  process.exit(1);
});
