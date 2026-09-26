'use client';

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { isFeeDeclined, isTransactionPending } from './connect-failure';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Contract, pureCircuits } from '@once/contract';
import { witnesses as sharedWitnesses, type OncePrivateState } from '@once/witness';
import { buildProviders, ONCE_PRIVATE_STATE_ID, type OnceProviders } from './providers';
import { ensureIssuerSecret, writeIssuerPublicKey,
  readDeployProgress, writeDeployProgress,
} from './private-state';
import { Recorder } from './measure';
import { DEMO } from './demo-fixtures';

export { DEMO };

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

/**
 * 오류를 사람이 읽을 수 있는 한 줄로 만든다.
 *
 * 앞선 시도에서 이 함수가 **빈 문자열**을 돌려줘 화면에 "중단:" 만 찍혔다.
 * 메시지가 비어 있는 Error 를 그대로 담았기 때문이다. 오류 객체의 모양을
 * 가정하지 않는다. Effect 계열은 Error 가 아닐 수도 있고, message 대신
 * _tag 만 갖기도 하며, cause 가 Error 가 아닌 Cause 객체일 수도 있다.
 *
 * 무엇이 오든 빈 문자열만은 돌려주지 않는다. 화면이 침묵하면 원인을
 * 좁힐 방법이 없다.
 */
function describeOne(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);

  const obj = value as Record<string, unknown>;
  const bits: string[] = [];

  const name = typeof obj['name'] === 'string' ? obj['name'] : value.constructor?.name;
  const tag = typeof obj['_tag'] === 'string' ? obj['_tag'] : undefined;
  const message = typeof obj['message'] === 'string' ? obj['message'] : undefined;

  if (tag) bits.push(tag);
  else if (name && name !== 'Object') bits.push(name);
  if (message !== undefined && message !== '') bits.push(message);

  /*
   * 이름과 태그만 있고 내용이 없으면 속성을 훑는다.
   *
   * Effect 의 Cause 는 message 를 갖지 않고 실제 페이로드를 error·defect·
   * failure 안에 넣는다. 이름만 찍으면 "Error ← Fail" 같은 쓸모없는 줄이
   * 나온다. 실제로 겪었다.
   */
  if (message === undefined || message === '') {
    for (const key of ['error', 'defect', 'failure', 'reason', 'code', 'status']) {
      const nested = obj[key];
      if (nested === undefined || nested === null) continue;
      const text = typeof nested === 'object' ? describeOne(nested) : String(nested);
      if (text !== '') bits.push(`${key}=${text}`);
    }
  }

  if (bits.length === 0) {
    const text = String(value);
    if (text !== '[object Object]') return text;
    try {
      return JSON.stringify(value, Object.getOwnPropertyNames(value)).slice(0, 300);
    } catch {
      return '(설명할 수 없는 오류 객체)';
    }
  }
  return bits.join(': ');
}

function describeFailure(error: unknown, recorder: Recorder): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();

  // cause 뿐 아니라 Effect 가 쓰는 자리도 따라간다.
  const nextOf = (value: unknown): unknown => {
    const obj = value as Record<string, unknown> | null;
    if (!obj) return undefined;
    return obj['cause'] ?? obj['error'] ?? obj['defect'] ?? obj['failure'];
  };

  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null && !seen.has(current); depth += 1) {
    seen.add(current);
    const text = describeOne(current);
    if (text !== '' && !parts.includes(text)) parts.push(text);
    current = nextOf(current);
  }

  if (error instanceof Error && typeof error.stack === 'string') {
    const frame = error.stack.split('\n').find((line) => line.includes('at '));
    if (frame) parts.push(frame.trim().slice(0, 160));
  }

  for (const failure of recorder.fetchFailures) {
    parts.push(`요청 실패: ${failure.url} — ${failure.reason}`);
  }

  /*
   * 구간별 소요 시간.
   *
   * 어디서 시간이 갔는지가 가장 좁은 단서다. balance 에서 30초면 지갑을
   * 기다린 것이고, submit 이면 제출이 안 끝난 것이며, 아무 구간도 없으면
   * 그 이전에 죽은 것이다.
   */
  const byPhase = new Map<string, { count: number; ms: number }>();
  for (const phase of recorder.phases) {
    const acc = byPhase.get(phase.phase) ?? { count: 0, ms: 0 };
    byPhase.set(phase.phase, { count: acc.count + 1, ms: acc.ms + phase.ms });
  }
  const timings = [...byPhase.entries()]
    .map(([phase, acc]) => `${phase} ${acc.count}회 ${(acc.ms / 1000).toFixed(1)}s`)
    .join(' · ');
  parts.push(timings === '' ? '구간 기록 없음' : `구간: ${timings}`);

  return parts.length === 0 ? '알 수 없는 오류' : parts.join(' ← ');
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
  /** 진행 중 알림. 기다리는 중이라는 것을 말하지 않으면 멈춘 것으로 읽힌다. */
  note?: string;
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
  /**
   * 앞선 실행을 이어받을 것인가.
   *
   * 기본값이 true 다. 중간에 끊긴 배포를 처음부터 다시 하는 것은 거의 항상
   * 잘못된 선택이다 — 컨트랙트를 새로 올리고 앞의 성공분을 버린다. 처음부터
   * 하고 싶을 때만 false 를 준다.
   */
  resume = true,
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

  /**
   * 앞 트랜잭션이 확정될 시간을 준 뒤 다음 단계로 간다.
   *
   * 처음에는 `getDustBalance()` 가 0 이 아니게 될 때까지 기다리게 했는데
   * **아무 일도 하지 않았다.** 1am 이 돌려주는 값은 내 DUST 가 아니라
   * proof server 의 대납 한도이고, 그건 늘 만충이라 첫 조회에서 바로
   * 빠져나갔다. 가설이 틀렸으면 코드도 틀린 것이다.
   *
   * 지금은 실측에 기댄다. 이 기기에서 성공한 6단계가 30.98 · 31.23 ·
   * 29.29 · 30.75 · 82.43 · 49.78초였고, 앞선 Lace 배포도 29.5~44.5초였다.
   * 확정에 그만큼 걸린다는 뜻이므로 다음 요청을 그 전에 보내면 대납이
   * 거절된다. 그렇다고 길게 깔면 8단계 내내 그만큼 쌓인다(25초였을 때 3분
   * 가까이 더 걸렸다). 회로 호출은 블록 확정까지 기다린 뒤 돌아오므로 앞 건은
   * 이미 체인에 있다 — 대납 서버가 그걸 알아채는 짧은 틈만 준다. 5초를 깔고,
   * 그래도 거절당하면 아래 재시도가 짧은 간격부터 받는다.
   */
  const SETTLE_FLOOR_MS = 5_000;

  const waitForSettlement = async (note: (text: string) => void): Promise<void> => {
    const started = Date.now();
    for (;;) {
      const elapsed = Date.now() - started;
      if (elapsed >= SETTLE_FLOOR_MS) return;
      note(`앞 트랜잭션 확정 대기 ${Math.round((SETTLE_FLOOR_MS - elapsed) / 1000)}초 남음`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  };

  /*
   * 간격의 근거는 실측이다. 이 기기에서 성공한 단계가 29~82초였고 앞선
   * Lace 배포도 29.5~44.5초였다. 그중 증명은 1초 남짓이니 나머지가 전부
   * 확정 대기다. 몇 초 만에 다시 내봐야 같은 이유로 또 거절당한다.
   */
  // 짧은 간격부터 늘려 간다. 대부분 첫 재시도에서 풀리고, 상한은 합쳐 80초다.
  const PENDING_RETRY_DELAYS_MS = [5_000, 10_000, 15_000, 20_000, 30_000];

  const runWithPendingRetry = async (
    body: () => Promise<{ txId?: string; block?: number }>,
    onWait: (attempt: number, delayMs: number) => void,
  ): Promise<{ txId?: string; block?: number }> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await body();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const delay = PENDING_RETRY_DELAYS_MS[attempt];
        /*
         * 같은 원인이 두 모양으로 온다. 대납 서버에 앞 건이 걸려 있으면
         * 지갑이 "already pending" 을 바로 던지기도 하고, 대납 실패 창을
         * 띄워 사용자가 Reject 를 누르면 "User declined to pay dust fee"
         * 가 온다 — 내 DUST 가 없으면 그 창에서 누를 수 있는 게 Reject
         * 뿐이다. 뒤쪽을 재시도하지 않아서 그 경로로 가면 바로 죽었다.
         *
         * 정말 그만두고 싶어서 누른 경우에도 재시도가 돈다. 간격이 길고
         * 네 번이 상한이라 창이 무한히 뜨지는 않는다.
         */
        const retryable = isTransactionPending(message) || isFeeDeclined(message);
        if (!retryable || delay === undefined) throw error;
        onWait(attempt + 1, delay);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  };

  const run = async (step: StepResult, body: () => Promise<{ txId?: string; block?: number }>) => {
    step.state = 'running';
    recorder.setStep(step.id);
    report();
    const started = performance.now();
    try {
      /*
       * 첫 단계가 아니면 앞 트랜잭션이 지갑에서 정리되기를 먼저 기다린다.
       * 거부당한 뒤 재시도하는 것보다 싸다 — 재시도는 증명과 잔액 조정을
       * 통째로 다시 한다.
       */
      if (step.id !== list[0]!.id) {
        await waitForSettlement((text) => {
          step.note = text;
          report();
        });
      }
      const out = await runWithPendingRetry(body, (attempt, delayMs) => {
        /*
         * 기다리는 중이라는 것을 화면에 적는다. 말하지 않으면 멈춘 것으로
         * 읽히고, 사람이 새로고침해서 상태를 더 헝클어 놓는다.
         */
        step.note = `앞 트랜잭션 확정 대기 ${attempt}회 (${delayMs / 1000}초)`;
        report();
      });
      step.note = undefined;
      step.ms = performance.now() - started;
      step.proveMs = recorder.totalFor(step.id, 'prove') ?? undefined;
      step.txId = out.txId;
      step.blockHeight = out.block;
      step.state = 'done';
    } catch (error: unknown) {
      /*
       * 원본을 콘솔에 그대로 남긴다.
       *
       * 화면 문구는 한 줄로 줄이는 과정에서 무언가를 잃는다. 개발자 도구를
       * 열 수 있는 상황이라면 객체 원본이 가장 확실한 단서다.
       */
      console.error(`[once] ${step.id} 실패`, error);
      step.ms = performance.now() - started;
      step.error = describeFailure(error, recorder);
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

  /*
   * 끝낸 단계를 남긴다.
   *
   * 초기 설정은 트랜잭션 8건이고 한 건에 30~80초다. 중간에 하나가 죽으면
   * 지금까지는 처음부터 다시 했다 — 컨트랙트를 새로 배포하고 앞의 성공분을
   * 통째로 버렸다. 수수료가 유한한 환경(대납 한도·DUST)에서는 그게 가장
   * 비싼 실패 방식이다.
   */
  const prior = resume ? await readDeployProgress() : null;
  const done = new Set<string>(prior?.done ?? []);

  const remember = async () => {
    if (contractAddress === null) return;
    await writeDeployProgress({
      contractAddress,
      issuerPublicKey,
      done: [...done],
      at: new Date().toISOString(),
      completed: done.size === list.length,
    });
  };

  /** 이미 끝낸 단계는 건너뛴다. 화면에는 건너뛴 것으로 남긴다. */
  const step = async (target: StepResult, body: () => Promise<{ txId?: string; block?: number }>) => {
    if (done.has(target.id)) {
      target.state = 'done';
      target.note = '앞선 실행에서 완료';
      report();
      return;
    }
    await run(target, body);
    done.add(target.id);
    await remember();
  };

  try {
    await step(list[0]!, async () => {
      /*
       * 이어받을 컨트랙트가 있으면 새로 배포하지 않는다. 배포를 다시 하면
       * 주소가 바뀌어 앞의 등록·예치가 전부 남의 컨트랙트 것이 된다.
       */
      if (prior) {
        const found = await findDeployedContract(providers as never, {
          contractAddress: prior.contractAddress,
          contract: compiled as never,
          privateStateId: ONCE_PRIVATE_STATE_ID,
          initialPrivateState: privateState,
        } as never);
        deployed = found as never;
        contractAddress = prior.contractAddress;
        return {};
      }
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
      await step(list[index]!, async () =>
        finish(await callTx()['registerLender']!(hexToBytes(lender.key))),
      );
      index += 1;
    }
    for (const lender of DEMO.lenders) {
      await step(list[index]!, async () =>
        finish(await callTx()['fundLender']!(hexToBytes(lender.key), DEMO.funding)),
      );
      index += 1;
    }

    const ownerPk = pureCircuits.ownerPublicKey(hexToBytes(DEMO.supplierSecret));
    for (const invoice of DEMO.invoices) {
      const leaf = pureCircuits.invoiceLeaf(hexToBytes(invoice.id), invoice.faceAmount, ownerPk);
      await step(list[index]!, async () => finish(await callTx()['registerInvoice']!(leaf)));
      index += 1;
    }
    /*
     * 전부 끝났다. 기록은 지우지 않는다 — 완료 표시는 마지막 단계의
     * remember() 가 이미 남겼다. 주소가 연습용 서버 설정과 키 내보내기에
     * 필요하다. 다시 [배포 시작] 을 누르면 여덟 단계가 전부 건너뛰어질
     * 뿐이라 무해하고, 새로 올리는 길은 [새로 배포] 하나다.
     */
  } catch {
    // 단계에 이미 기록했다. 여기서는 부분 결과를 그대로 돌려준다.
  }

  return { contractAddress, issuerPublicKey, steps: list, recorder };
}
