'use client';

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { deployContract } from '@midnight-ntwrk/midnight-js/contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Contract, pureCircuits } from '@once/contract';
import { witnesses as sharedWitnesses, type OncePrivateState } from '@once/witness';
import { buildProviders, ONCE_PRIVATE_STATE_ID, type OnceProviders } from './providers';
import { ensureIssuerSecret, writeIssuerPublicKey } from './private-state';
import { Recorder } from './measure';

/**
 * 브라우저 + Lace 로 컨트랙트를 올리고 데모 상태를 세운다.
 *
 * S6-b·c 를 닫는 것이 목적이다.
 *
 *   S6-b  회로 증명 소요 시간을 실측한다. 배포 트랜잭션은 finance 회로를
 *         부르지 않으므로 배포만으로는 측정되지 않는다. registerLender 부터가
 *         진짜 회로 호출이다.
 *   S6-c  IndexedDB 에 둔 issuerSecret 이 witness 로 회로에 전달되는지 본다.
 *         회로가 issuerPublicKey(issuerSecret()) == issuerPk 를 assert 하므로,
 *         **registerLender 가 성공하면 그 값이 IndexedDB 에서 온 올바른
 *         비밀키였다는 뜻이다.** 로그가 아니라 회로가 증명한다.
 *
 * 증명은 브라우저 CPU 가 아니라 proof server 에서 일어난다. 클라이언트는
 * prover key 를 payload 에 실어 /prove 로 POST 한다. 그래서 여기서 재는
 * 시간은 "업로드 + 서버 증명 + 다운로드"다. 그 사실을 보고서에 그대로 쓴다.
 */

/**
 * 데모 고정값.
 *
 * **issuerSecret 은 여기 없다.** 저장소에 적힌 더미값을 테스트넷에 올리면
 * 누구나 registerInvoice·fundLender 를 부를 수 있다. 배포용 비밀키는
 * 첫 실행 때 이 기기에서 만들어 IndexedDB 에만 둔다
 * (`ensureIssuerSecret`). Node 경로의 `requireSecret()` 과 같은 이유다.
 *
 * supplierSecret 은 채권 리프를 계산하는 데만 쓰이고, 그 리프의 소유권을
 * 증명하는 것은 소유자 비밀키를 가진 쪽이다. 데모 값을 그대로 둔다.
 */
export const DEMO = {
  issuerId: `0x${'11'.repeat(32)}`,
  supplierSecret: `0x${'7c'.repeat(32)}`,
  ltvBps: 8000n,
  lenders: [
    { id: 'lender-a', key: `0x${'0a'.repeat(32)}`, label: '금융사 A' },
    { id: 'lender-b', key: `0x${'0b'.repeat(32)}`, label: '금융사 B' },
  ],
  funding: 1_000_000_000n,
  invoices: [
    { id: `0x${'a1'.repeat(32)}`, faceAmount: 100_000_000n },
    { id: `0x${'a2'.repeat(32)}`, faceAmount: 50_000_000n },
    { id: `0x${'a3'.repeat(32)}`, faceAmount: 250_000_000n },
  ],
} as const;

export function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export type StepState = 'pending' | 'running' | 'done' | 'failed';

export interface StepResult {
  readonly id: string;
  readonly label: string;
  /** 회로를 부르는 단계인가. 배포는 아니다. */
  readonly provable: boolean;
  state: StepState;
  txId?: string;
  blockHeight?: number;
  ms?: number;
  /** 증명 구간만. 밸런싱·제출과 분리해서 잰다. */
  proveMs?: number;
  error?: string;
}

export interface BootstrapResult {
  readonly contractAddress: string | null;
  /** 이 기기에서 만든 발급 기관 공개키. 비밀키는 나가지 않는다. */
  readonly issuerPublicKey: string | null;
  readonly steps: readonly StepResult[];
  readonly recorder: Recorder;
}

/**
 * 계측을 끼운 프로바이더.
 *
 * proveTx·balanceTx·submitTx 를 각각 따로 잰다. 합계만 재면 느린 게
 * 증명인지 네트워크인지 지갑인지 구분할 수 없다.
 */
function instrument(providers: OnceProviders, recorder: Recorder): OnceProviders {
  const { proofProvider, walletProvider, midnightProvider } = providers;

  return {
    ...providers,
    proofProvider: {
      ...proofProvider,
      proveTx: (...args: Parameters<typeof proofProvider.proveTx>) =>
        recorder.time('prove', () => proofProvider.proveTx(...args)),
    },
    walletProvider: {
      ...walletProvider,
      balanceTx: (...args: Parameters<typeof walletProvider.balanceTx>) =>
        recorder.time('balance', () => walletProvider.balanceTx(...args)),
    },
    midnightProvider: {
      ...midnightProvider,
      submitTx: (...args: Parameters<typeof midnightProvider.submitTx>) =>
        recorder.time('submit', () => midnightProvider.submitTx(...args)),
    },
  };
}

/**
 * witness 를 감싸 호출 여부를 기록한다.
 *
 * **구현은 감싸기만 한다.** Node 시뮬레이터와 같은 코드(@once/witness)를
 * 그대로 쓴다. 브라우저용 사본을 만들면 갈라지고, 갈라진 쪽이 회로 검사를
 * 통과하지 않았는데 통과한 것처럼 보이게 된다.
 */
function recordingWitnesses(recorder: Recorder) {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(sharedWitnesses as Record<string, unknown>)) {
    out[name] = (...args: unknown[]) => {
      recorder.witnessFired(name);
      return (fn as (...a: unknown[]) => unknown)(...args);
    };
  }
  return out;
}

function steps(): StepResult[] {
  return [
    { id: 'deploy', label: '컨트랙트 배포', provable: false, state: 'pending' },
    ...DEMO.lenders.map((lender) => ({
      id: `registerLender:${lender.id}`,
      label: `금융사 등록 · ${lender.label}`,
      provable: true,
      state: 'pending' as StepState,
    })),
    ...DEMO.lenders.map((lender) => ({
      id: `fundLender:${lender.id}`,
      label: `자금 예치 · ${lender.label}`,
      provable: true,
      state: 'pending' as StepState,
    })),
    ...DEMO.invoices.map((invoice, index) => ({
      id: `registerInvoice:${index}`,
      label: `채권 등록 #${index + 1}`,
      provable: true,
      state: 'pending' as StepState,
    })),
  ];
}

export function initialSteps(): StepResult[] {
  return steps();
}

/**
 * 배포와 초기 설정을 순서대로 실행한다.
 *
 * 한 단계마다 Lace 승인 팝업이 뜬다. 중간에 실패하면 거기서 멈추고
 * 어느 단계에서 무슨 오류였는지 남긴다.
 */
export async function runBootstrap(
  api: ConnectedAPI,
  onProgress: (steps: readonly StepResult[], recorder: Recorder) => void,
): Promise<BootstrapResult> {
  const recorder = new Recorder();
  const list = steps();
  const report = () => onProgress([...list], recorder);

  const providers = instrument(await buildProviders(api, recorder), recorder);

  const compiled = CompiledContract.withCompiledFileAssets(
    CompiledContract.withWitnesses(
      CompiledContract.make('once', Contract as never),
      recordingWitnesses(recorder) as never,
    ) as never,
    new URL('/zk', window.location.origin).toString() as never,
  );

  /*
   * IndexedDB 에 저장될 비공개 상태. 발급 기관 비밀키가 여기 들어간다.
   * 첫 실행이면 이 기기에서 새로 만든다. 저장소의 더미값을 쓰지 않는다.
   */
  const issuerSecret = await ensureIssuerSecret();
  const privateState: OncePrivateState = { issuerSecret, activeInvoice: null };

  // 진입 화면이 WASM 없이 대조할 수 있도록 공개키를 같이 저장한다.
  const issuerPublicKey = bytesToHex(pureCircuits.issuerPublicKey(issuerSecret));
  await writeIssuerPublicKey(issuerPublicKey);

  let contractAddress: string | null = null;
  let deployed: { callTx: Record<string, (...args: unknown[]) => Promise<unknown>> } | null = null;

  const run = async (step: StepResult, body: () => Promise<{ txId?: string; block?: number }>) => {
    step.state = 'running';
    recorder.setStep(step.id);
    report();
    const started = performance.now();
    try {
      const out = await body();
      step.ms = performance.now() - started;
      step.proveMs = recorder.totalFor(step.id, 'prove') ?? undefined;
      step.txId = out.txId;
      step.blockHeight = out.block;
      step.state = 'done';
    } catch (error: unknown) {
      step.ms = performance.now() - started;
      step.error = error instanceof Error ? error.message : String(error);
      step.state = 'failed';
      report();
      throw error;
    }
    report();
  };

  const finish = (result: unknown): { txId?: string; block?: number } => {
    const pub = (result as { public?: { txId?: string; blockHeight?: number } } | undefined)?.public;
    return { txId: pub?.txId, block: pub?.blockHeight };
  };

  try {
    await run(list[0]!, async () => {
      const result = await deployContract(providers as never, {
        compiledContract: compiled as never,
        privateStateId: ONCE_PRIVATE_STATE_ID,
        initialPrivateState: privateState,
        args: [
          hexToBytes(DEMO.issuerId),
          pureCircuits.issuerPublicKey(issuerSecret),
          DEMO.ltvBps,
        ],
      } as never);
      deployed = result as never;
      const data = (result as { deployTxData: { public: { contractAddress: string; txId: string; blockHeight: number } } })
        .deployTxData.public;
      contractAddress = data.contractAddress;
      return { txId: data.txId, block: data.blockHeight };
    });

    const callTx = () => {
      if (!deployed) throw new Error('컨트랙트가 아직 배포되지 않았다');
      return deployed.callTx;
    };

    let index = 1;
    for (const lender of DEMO.lenders) {
      await run(list[index]!, async () =>
        finish(await callTx()['registerLender']!(hexToBytes(lender.key))),
      );
      index += 1;
    }
    for (const lender of DEMO.lenders) {
      await run(list[index]!, async () =>
        finish(await callTx()['fundLender']!(hexToBytes(lender.key), DEMO.funding)),
      );
      index += 1;
    }

    const ownerPk = pureCircuits.ownerPublicKey(hexToBytes(DEMO.supplierSecret));
    for (const invoice of DEMO.invoices) {
      const leaf = pureCircuits.invoiceLeaf(hexToBytes(invoice.id), invoice.faceAmount, ownerPk);
      await run(list[index]!, async () => finish(await callTx()['registerInvoice']!(leaf)));
      index += 1;
    }
  } catch {
    // 단계에 이미 기록했다. 여기서는 부분 결과를 그대로 돌려준다.
  }

  return { contractAddress, issuerPublicKey, steps: list, recorder };
}
