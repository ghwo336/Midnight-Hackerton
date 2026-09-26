'use client';

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { createUnprovenCallTx, findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';
import { isFeeDeclined, isTransactionPending } from './connect-failure';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Contract } from '@once/contract';
import {
  emptyPrivateState, withActiveInvoice,
  witnesses as sharedWitnesses, type OncePrivateState,
} from '@once/witness';
import { buildProviders, ONCE_PRIVATE_STATE_ID, type OnceProviders } from './providers';
import { ensureIssuerSecret, readIssuerSecret } from './private-state';
import { hexToBytes } from './bootstrap';
import { Recorder } from './measure';
import type { TxPhase } from '@/shared/runtime/tx-phase';

export type { TxPhase };

/**
 * 브라우저가 직접 회로를 부른다.
 *
 * **서버는 서명하지 않는다.** 개인키는 지갑에만 있다. 서버가 할 수 있는
 * 일은 신청 전에 알 수 있는 것을 확인하고 재료를 건네는 것까지이고
 * (`/api/supplier/financing/prepare`), 증명·서명·제출은 여기서 일어난다.
 *
 * 채권 원문은 이 과정에서 회로 witness 로만 들어가고 트랜잭션에는
 * nullifier 와 commitment 만 남는다. 그게 회로가 disclose 한 값 전부다.
 */

export type PhaseListener = (phase: TxPhase) => void;

export interface ChainCallResult {
  readonly txHash: string;
  readonly block: number;
  /** 구간별 실측. 보고서에 그대로 옮긴다. */
  readonly recorder: Recorder;
}

/** 서버가 건네준 신청 재료. `/api/supplier/financing/prepare` 의 응답. */
export interface FinancingPlan {
  readonly applicationId: string;
  readonly receivedAt: string;
  readonly lenderKey: string;
  readonly recipient: string;
  readonly amount: string;
  readonly nullifier: string;
  readonly witness: {
    readonly invoiceId: string;
    readonly faceAmount: string;
    readonly salt: string;
    readonly ownerSecret: string;
  };
}

/**
 * 회로가 낸 거부를 도메인 코드로 옮긴다.
 *
 * 회로의 assert 문자열을 그대로 대조한다. once.compact 를 고치면 여기도
 * 같이 고쳐야 한다 — 못 맞추면 `null` 이 되고, 화면은 "회로가 거부했다"
 * 까지만 말하고 사유를 지어내지 않는다.
 */
const CIRCUIT_REJECTIONS: readonly (readonly [string, string])[] = [
  ['nullifier already used', 'NULLIFIER_ALREADY_USED'],
  ['amount exceeds LTV', 'AMOUNT_EXCEEDS_LTV'],
  ['lender not registered', 'LENDER_NOT_REGISTERED'],
  ['invoice not attested by issuer', 'ISSUER_ATTESTATION_FAILED'],
  ['invoice leaf mismatch', 'ISSUER_ATTESTATION_FAILED'],
  ['insufficient lender funding', 'INSUFFICIENT_LENDER_FUNDING'],
  ['loan not found', 'LOAN_NOT_FOUND'],
  ['loan already repaid', 'LOAN_ALREADY_REPAID'],
  ['repayment below principal', 'REPAYMENT_BELOW_PRINCIPAL'],
];

export function classifyCircuitError(error: unknown): string | null {
  const text = describe(error).toLowerCase();
  for (const [needle, code] of CIRCUIT_REJECTIONS) {
    if (text.includes(needle.toLowerCase())) return code;
  }
  return null;
}

/** 오류 객체에서 사람이 읽을 수 있는 문자열을 뽑는다. 빈 문자열을 내지 않는다. */
export function describe(error: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current: unknown = error;
  while (current && !seen.has(current) && parts.length < 6) {
    seen.add(current);
    if (typeof current === 'string') {
      parts.push(current);
      break;
    }
    const obj = current as Record<string, unknown>;
    const message = typeof obj['message'] === 'string' ? obj['message'] : null;
    if (message && message.length > 0) parts.push(message);
    current = obj['cause'] ?? obj['error'] ?? obj['defect'] ?? obj['failure'] ?? null;
  }
  return parts.length === 0 ? String(error) : parts.join(' ← ');
}

/**
 * 구간 전이를 알리도록 프로바이더를 감싼다.
 *
 * 각 구간의 소요 시간도 같이 잰다 (`recorder`). 두 가지가 같은 곳에서
 * 나와야 화면에 보이는 단계와 보고서의 숫자가 어긋나지 않는다.
 */
function phased(
  providers: OnceProviders,
  recorder: Recorder,
  onPhase: PhaseListener,
): OnceProviders {
  const { proofProvider, walletProvider, midnightProvider } = providers;
  return {
    ...providers,
    proofProvider: {
      ...proofProvider,
      proveTx: (...args: Parameters<typeof proofProvider.proveTx>) => {
        onPhase('proving');
        return recorder.time('prove', () => proofProvider.proveTx(...args));
      },
    },
    walletProvider: {
      ...walletProvider,
      balanceTx: (...args: Parameters<typeof walletProvider.balanceTx>) => {
        onPhase('balancing');
        return recorder.time('balance', () => walletProvider.balanceTx(...args));
      },
    },
    midnightProvider: {
      ...midnightProvider,
      submitTx: async (...args: Parameters<typeof midnightProvider.submitTx>) => {
        onPhase('submitting');
        const out = await recorder.time('submit', () => midnightProvider.submitTx(...args));
        // 제출은 끝났고 이제 블록을 기다린다. 여기가 보통 가장 길다.
        onPhase('confirming');
        return out;
      },
    },
  };
}

function compiledContract(recorder: Recorder) {
  return CompiledContract.withCompiledFileAssets(
    CompiledContract.withWitnesses(
      CompiledContract.make('once', Contract as never),
      recordingWitnesses(recorder) as never,
    ) as never,
    new URL('/zk', window.location.origin).toString() as never,
  );
}

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

/** 배포 때 만든 발급 기관 비밀키를 이어 쓴다. 이 기기 밖으로 나가지 않는다. */
async function baseState(): Promise<OncePrivateState> {
  try {
    return { ...emptyPrivateState(), issuerSecret: await ensureIssuerSecret() };
  } catch {
    // 발급 권한이 없는 기기다. finance·repay 는 발급자 비밀키를 쓰지 않는다.
    return emptyPrivateState();
  }
}

interface Attached {
  readonly callTx: Record<
    string,
    // SDK 의 FinalizedTxData 중 쓰는 것만. txId 는 식별자, txHash 가 인덱서·탐색기의 해시다.
    (...args: unknown[]) => Promise<{ public: { txId: string; txHash: string; blockHeight: number } }>
  >;
}

/**
 * 이미 배포된 컨트랙트에 붙는다.
 *
 * 비공개 상태를 **명시적으로 덮어쓴다.** `initialPrivateState` 는 저장된
 * 상태가 없을 때만 쓰이므로, 배포 때 쓴 상태(activeInvoice 가 null)가
 * 그대로 남아 있으면 witness 가 "no active invoice" 로 죽는다.
 */
async function attach(
  providers: OnceProviders,
  contractAddress: string,
  recorder: Recorder,
  privateState: OncePrivateState,
): Promise<Attached> {
  await providers.privateStateProvider.set(ONCE_PRIVATE_STATE_ID as never, privateState as never);
  const contract = await findDeployedContract(providers as never, {
    contractAddress,
    compiledContract: compiledContract(recorder) as never,
    privateStateId: ONCE_PRIVATE_STATE_ID,
    initialPrivateState: privateState,
  } as never);
  return contract as unknown as Attached;
}

/**
 * 신청을 준비하고, 돌려주는 함수를 부르면 **그때 회로를 실행해** 제출한다.
 *
 * 한때 이 함수가 A6 용이라고 적혀 있었다. "중복 확인값이 비어 있을 때 준비해
 * 두었다가 나중에 제출한다" 는 뜻이었는데, 실제로 준비하는 것은 컨트랙트 연결과
 * 비공개 상태뿐이었다. 회로 실행과 증명은 submit() 안의 callTx 가 **제출하는
 * 순간의 원장으로** 한다. 그래서 A6 에 쓰면 다른 금융사가 확정된 뒤라 내 브라우저의
 * 회로가 assert 에서 먼저 막고, 체인에는 닿지도 않는다 — 체인의 실행 시점
 * 재검사는 시험되지 않고 판정만 '통과' 로 켜진다.
 *
 * 정상 신청 경로(financeOnChain)는 준비와 제출 사이가 붙어 있어 문제없다.
 * A6 는 prepareStaleFinanceCall 을 쓴다.
 */
export async function prepareFinanceCall(
  api: ConnectedAPI,
  contractAddress: string,
  plan: FinancingPlan,
  onPhase: PhaseListener = () => undefined,
): Promise<{ submit: () => Promise<ChainCallResult>; recorder: Recorder }> {
  const recorder = new Recorder();
  recorder.setStep('finance');
  onPhase('preparing');

  const providers = phased(await buildProviders(api, recorder), recorder, onPhase);
  const privateState = withActiveInvoice(await baseState(), {
    invoiceId: plan.witness.invoiceId as `0x${string}`,
    faceAmount: BigInt(plan.witness.faceAmount),
    salt: plan.witness.salt as `0x${string}`,
    ownerSecret: plan.witness.ownerSecret as `0x${string}`,
  });

  const contract = await attach(providers, contractAddress, recorder, privateState);
  const call = contract.callTx['finance'];
  if (!call) throw new Error('finance 회로를 찾지 못했다');

  return {
    recorder,
    submit: async () => {
      /*
       * 비공개 상태를 제출 직전에 다시 써 넣는다.
       *
       * 준비와 제출 사이에 다른 신청이 끼어들면 저장소의 activeInvoice 가
       * 그쪽 채권으로 바뀌어 있다. 그대로 두면 이 신청이 엉뚱한 채권의
       * 증명을 만든다.
       */
      await providers.privateStateProvider.set(
        ONCE_PRIVATE_STATE_ID as never, privateState as never,
      );
      const result = await call(
        hexToBytes(plan.lenderKey),
        BigInt(plan.amount),
        { bytes: hexToBytes(plan.recipient) },
      );
      onPhase('done');
      /*
       * txId 가 아니라 txHash 를 쓴다. txId 는 트랜잭션 식별자(33바이트)이고
       * 인덱서·탐색기가 쓰는 해시가 아니다. 한동안 txId 를 해시 자리에 넣어서
       * 서버가 형식 검사에서 성공 보고를 전부 거절했다.
       */
      return { txHash: result.public.txHash, block: result.public.blockHeight, recorder };
    },
  };
}

/**
 * 체인이 트랜잭션을 실행했고 실패로 기록했다.
 *
 * 체인이 실제로 판단했다는 증거다. 지갑·대납 서버에서 죽은 것과 구분하려고
 * 따로 둔다 — 그 둘을 섞으면 A6 가 아무것도 시험하지 않고 통과한다.
 */
export class ChainRejectedError extends Error {
  override readonly name = 'ChainRejectedError';
  constructor(readonly status: string, readonly txHash: string) {
    super(`체인이 트랜잭션을 실패로 기록했다 (상태 ${status}, tx ${txHash})`);
  }
}

/**
 * 제출했는데 정해진 시간 안에 블록에 들어오지 않았다.
 *
 * SDK 의 확정 대기(watchForTxData)는 끝없이 기다린다. 노드가 트랜잭션을 아예
 * 받지 않는 경우(guaranteed 단계 실패) 화면이 영원히 멈춘다. 체인이 판단했다는
 * 증거가 아니므로 이것으로 통과를 켜지 않는다.
 */
export class NotIncludedError extends Error {
  override readonly name = 'NotIncludedError';
  constructor(readonly txId: string, readonly waitedMs: number) {
    super(`제출한 트랜잭션이 ${Math.round(waitedMs / 1000)}초 안에 블록에 들어오지 않았다 (tx ${txId})`);
  }
}

/** 체인에 포함됐지만 실패한 트랜잭션이면 그 상태값. 아니면 null. */
export function chainStatusOf(error: unknown): string | null {
  if (error instanceof ChainRejectedError) return error.status;
  // callTx 경로: SDK 의 CallTxFailedError 가 finalizedTxData 를 든다.
  const fin = (error as { finalizedTxData?: { status?: unknown } } | null)?.finalizedTxData;
  if (fin && typeof fin.status === 'string' && fin.status !== SucceedEntirely) return fin.status;
  return null;
}

/** A6 의 확정 대기 상한. 한 건이 보통 30~80초라 넉넉히 둔다. */
const STALE_INCLUSION_TIMEOUT_MS = 5 * 60_000;

/** 대납 서버에 앞 건이 걸려 있으면 기다렸다 다시 잔액 조정을 한다. */
const STALE_BALANCE_RETRY_MS = [15_000, 30_000, 45_000, 60_000];

/**
 * A6 용. **미사용 시점에 회로를 실행하고 증명까지 만들어** 들고 있다가,
 * 돌려주는 함수를 부르면 그 트랜잭션을 그대로 제출한다.
 *
 * A6 가 시험하는 것은 "미사용 시점에 만든 증명을 사용 후에 내면 체인이 실행
 * 시점에 막는가" 다. 그러려면 원장을 읽고 공개 트랜스크립트를 고정하는 일
 * (createUnprovenCallTx)과 증명(proveTx)이 **준비 시점**에 끝나 있어야 한다.
 * 제출할 때는 잔액 조정·제출·확정 대기만 하고, 원장을 다시 읽지 않는다.
 * SDK 의 submitTx 도 같은 순서(prove → balance → submit)인데 증명을 안에서
 * 하므로 쓰지 않고 풀어서 부른다.
 *
 * 결과는 체인이 정한다. 성공으로 기록되면 이중 담보가 뚫린 것이고(A6 실패),
 * 실패로 기록되면 ChainRejectedError, 블록에 안 들어오면 NotIncludedError.
 * 비공개 상태는 갱신하지 않는다 — 이 신청은 성공해선 안 되는 신청이다.
 */
export async function prepareStaleFinanceCall(
  api: ConnectedAPI,
  contractAddress: string,
  plan: FinancingPlan,
  onPhase: PhaseListener = () => undefined,
  options: { readonly inclusionTimeoutMs?: number } = {},
): Promise<{ submit: () => Promise<ChainCallResult>; recorder: Recorder }> {
  const recorder = new Recorder();
  recorder.setStep('finance');
  onPhase('preparing');

  const providers = phased(await buildProviders(api, recorder), recorder, onPhase);
  const privateState = withActiveInvoice(await baseState(), {
    invoiceId: plan.witness.invoiceId as `0x${string}`,
    faceAmount: BigInt(plan.witness.faceAmount),
    salt: plan.witness.salt as `0x${string}`,
    ownerSecret: plan.witness.ownerSecret as `0x${string}`,
  });
  providers.privateStateProvider.setContractAddress(contractAddress as never);
  await providers.privateStateProvider.set(ONCE_PRIVATE_STATE_ID as never, privateState as never);

  // 여기서 원장을 읽는다. 지금 이 nullifier 는 미사용이어야 한다.
  const unsubmitted = (await createUnprovenCallTx(providers as never, {
    compiledContract: compiledContract(recorder),
    circuitId: 'finance',
    contractAddress,
    args: [hexToBytes(plan.lenderKey), BigInt(plan.amount), { bytes: hexToBytes(plan.recipient) }],
    privateStateId: ONCE_PRIVATE_STATE_ID,
  } as never)) as unknown as { private: { unprovenTx: Parameters<typeof providers.proofProvider.proveTx>[0] } };

  const proven = await providers.proofProvider.proveTx(unsubmitted.private.unprovenTx);
  const timeoutMs = options.inclusionTimeoutMs ?? STALE_INCLUSION_TIMEOUT_MS;

  return {
    recorder,
    submit: async () => {
      /*
       * 잔액 조정만 재시도한다. 셋업 대출이 방금 확정된 직후라 대납 서버가
       * 아직 그 건을 pending 으로 잡고 있을 수 있다. 증명은 이미 들고 있으므로
       * 다시 만들지 않는다 — 다시 만들면 새 원장을 읽게 되고 시험이 무너진다.
       */
      let balanced: Awaited<ReturnType<typeof providers.walletProvider.balanceTx>> | null = null;
      for (let attempt = 0; balanced === null; attempt += 1) {
        try {
          balanced = await providers.walletProvider.balanceTx(proven);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          const delay = STALE_BALANCE_RETRY_MS[attempt];
          if (!(isTransactionPending(message) || isFeeDeclined(message)) || delay === undefined) {
            throw error;
          }
          onPhase('balancing');
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      const txId = await providers.midnightProvider.submitTx(balanced);

      let timer: ReturnType<typeof setTimeout> | undefined;
      const finalized = await Promise.race([
        providers.publicDataProvider.watchForTxData(txId),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new NotIncludedError(String(txId), timeoutMs)), timeoutMs);
        }),
      ]).finally(() => clearTimeout(timer));

      if (finalized.status !== SucceedEntirely) {
        throw new ChainRejectedError(finalized.status, finalized.txHash);
      }
      onPhase('done');
      return { txHash: finalized.txHash, block: finalized.blockHeight, recorder };
    },
  };
}

/** 대출 신청. 지급까지 한 트랜잭션이다 (INV-3). */
export async function financeOnChain(
  api: ConnectedAPI,
  contractAddress: string,
  plan: FinancingPlan,
  onPhase: PhaseListener = () => undefined,
): Promise<ChainCallResult> {
  const { submit } = await prepareFinanceCall(api, contractAddress, plan, onPhase);
  return submit();
}

/**
 * 상환. **담보를 되살리지 않는다.**
 *
 * 회로가 usedNullifiers 를 건드리지 않으므로 상환 후에도 같은 채권으로는
 * 다시 대출받을 수 없다 (A10).
 */
export async function repayOnChain(
  api: ConnectedAPI,
  contractAddress: string,
  loan: { readonly nullifier: string; readonly amount: string },
  onPhase: PhaseListener = () => undefined,
): Promise<ChainCallResult> {
  const recorder = new Recorder();
  recorder.setStep('repay');
  onPhase('preparing');

  const providers = phased(await buildProviders(api, recorder), recorder, onPhase);
  /*
   * repay 는 채권 원문을 쓰지 않는다. nullifier 로 원장의 대출을 찾고
   * 그 기록에 적힌 금액·차주·금융사로만 움직인다. 그래서 activeInvoice 가
   * 없어도 된다.
   */
  const contract = await attach(providers, contractAddress, recorder, await baseState());
  const call = contract.callTx['repay'];
  if (!call) throw new Error('repay 회로를 찾지 못했다');

  const result = await call(hexToBytes(loan.nullifier), BigInt(loan.amount));
  onPhase('done');
  return { txHash: result.public.txHash, block: result.public.blockHeight, recorder };
}

/**
 * 채권 리프를 발급자 트리에 넣는다.
 *
 * **이 기기가 발급 권한을 쥐고 있어야 한다.** 회로가
 * `assert(issuerPublicKey(issuerSecret()) == issuerPk)` 를 보고, 그
 * `issuerSecret()` 은 IndexedDB 에 저장된 값을 witness 로 받는다. 서버는
 * 이 값을 모르고 알 필요도 없다.
 *
 * 비밀키가 없으면 만들지 않고 멈춘다. 새로 만들어 넣으면 회로가 거부하는데,
 * 화면에는 회로 메시지만 남아서 원인이 "권한 없는 기기" 라는 게 드러나지
 * 않는다.
 */
export async function registerInvoiceOnChain(
  api: ConnectedAPI,
  contractAddress: string,
  leaf: string,
  onPhase: PhaseListener = () => undefined,
): Promise<ChainCallResult> {
  const recorder = new Recorder();
  recorder.setStep('registerInvoice');
  onPhase('preparing');

  const issuerSecret = await readIssuerSecret();
  if (!issuerSecret) {
    throw new Error('이 기기에 발급 기관 비밀키가 없다. 컨트랙트를 배포한 브라우저에서 해야 한다');
  }

  const providers = phased(await buildProviders(api, recorder), recorder, onPhase);
  const privateState: OncePrivateState = { issuerSecret, activeInvoice: null };

  const contract = await attach(providers, contractAddress, recorder, privateState);
  const call = contract.callTx['registerInvoice'];
  if (!call) throw new Error('registerInvoice 회로를 찾지 못했다');

  const result = await call(hexToBytes(leaf));
  onPhase('done');
  return { txHash: result.public.txHash, block: result.public.blockHeight, recorder };
}
