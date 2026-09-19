'use client';

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
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
    (...args: unknown[]) => Promise<{ public: { txId: string; blockHeight: number } }>
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
 * 신청을 **준비만** 한다. 제출은 돌려주는 함수를 부를 때 일어난다.
 *
 * 둘로 나눈 이유는 A6 때문이다. 중복 확인값이 아직 비어 있을 때 준비해
 * 두었다가, 다른 신청이 확정된 뒤에 제출해야 "실행 시점에 다시 본다" 는
 * 성질을 시험할 수 있다. 한 함수로 묶으면 그 사이를 벌릴 수 없다.
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
      return { txHash: result.public.txId, block: result.public.blockHeight, recorder };
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
  return { txHash: result.public.txId, block: result.public.blockHeight, recorder };
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
  return { txHash: result.public.txId, block: result.public.blockHeight, recorder };
}
