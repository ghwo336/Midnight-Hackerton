'use client';

import type { LenderId, LoanRow } from '@/shared/api/types';
import type { FinancingStage } from '@/shared/sse/use-once-events';
import { TX_PHASE_LABEL, type TxPhase } from './tx-phase';

export interface LogLine {
  readonly at: string;
  readonly text: string;
  readonly tone: 'normal' | 'seal';
}

/**
 * 순차 노출 타임라인 (밀리초).
 *
 * **응답은 이미 도착해 있다. 데이터는 확정된 값이고, 표시 순서만 만든다.**
 * 인위적으로 요청을 늦추거나 가짜 단계를 넣지 않는다. 백엔드가 0.03초에
 * 끝냈다면 그 0.03초는 진행 단계에 실측값 그대로 찍히고, 아래 타임라인은
 * 그 결과를 사람이 따라갈 수 있게 펼쳐 보여줄 뿐이다.
 *
 * 전체 600ms 안에 끝난다.
 */
export const REVEAL = {
  /** 로그 한 줄당 간격 */
  logStep: 40,
  /** 금액 카운트업 시작 (400ms 동안 진행 → 600ms에 종료) */
  amountsAt: 200,
  /** 진행 단계 채워짐 */
  stagesAt: 260,
  /** 도장 + 패널 반응 */
  stampAt: 300,
  /** 원장에 행 추가 */
  ledgerAt: 360,
  total: 600,
} as const;

/** 화면에 무엇까지 드러났는지. 도착한 데이터와 별개다. */
export interface Reveal {
  readonly logCount: number;
  readonly stages: boolean;
  readonly stamp: boolean;
  readonly amounts: boolean;
  readonly ledger: boolean;
}

export const REVEAL_NONE: Reveal = {
  logCount: 0, stages: false, stamp: false, amounts: false, ledger: false,
};

export const REVEAL_ALL: Reveal = {
  logCount: Number.MAX_SAFE_INTEGER, stages: true, stamp: true, amounts: true, ledger: true,
};

/** 진행 중인 요청의 실시간 상태. 확정 이후에는 원장이 진실이다. */
export interface LenderRuntime {
  readonly phase: FinancingStage | 'idle';
  readonly startedAt: number | null;
  readonly stageMs: Partial<Record<FinancingStage, number>>;
  readonly block: number | null;
  readonly reason: string | null;
  readonly circuitAssert: string | null;
  readonly log: readonly LogLine[];
  /**
   * 실제 체인에서 지금 어느 구간인가. 시뮬레이터 경로에서는 null 이다.
   *
   * 한 건에 30~45초가 걸리고 그중 대부분이 지갑 승인과 블록 확정이다.
   * 무엇을 기다리는 중인지 말하지 않으면 멈춘 것으로 읽힌다.
   */
  readonly chainPhase: TxPhase | null;
  /** 그 구간에 들어간 시각. 구간별 경과를 보여주는 데 쓴다. */
  readonly phaseStartedAt: number | null;
}

export const IDLE_RUNTIME: LenderRuntime = {
  phase: 'idle',
  startedAt: null,
  stageMs: {},
  block: null,
  reason: null,
  circuitAssert: null,
  log: [],
  chainPhase: null,
  phaseStartedAt: null,
};

export type LenderRuntimes = Record<LenderId, LenderRuntime>;

export const INITIAL_RUNTIMES: LenderRuntimes = {
  'lender-a': IDLE_RUNTIME,
  'lender-b': IDLE_RUNTIME,
};

const STAGE_TEXT: Record<FinancingStage, string> = {
  witness: 'witness 구성',
  proving: '증명 생성 시작',
  submitting: '트랜잭션 제출',
  settled: '확정',
  rejected: '거부',
};

function clock(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

export function beginRequest(at: string): LenderRuntime {
  return {
    phase: 'witness',
    startedAt: Date.now(),
    stageMs: {},
    block: null,
    reason: null,
    circuitAssert: null,
    log: [{ at: clock(at), text: '대출 신청 접수', tone: 'normal' }],
    chainPhase: null,
    phaseStartedAt: null,
  };
}

/**
 * 실제 체인 구간이 바뀌었다.
 *
 * 앞 구간이 실제로 얼마나 걸렸는지 로그에 남긴다. 추정하지 않는다 —
 * 구간에 들어간 시각과 나온 시각의 차이다.
 */
export function applyChainPhase(current: LenderRuntime, phase: TxPhase): LenderRuntime {
  if (current.chainPhase === phase) return current;

  const now = Date.now();
  const log = [...current.log];
  if (current.chainPhase !== null && current.phaseStartedAt !== null) {
    const seconds = ((now - current.phaseStartedAt) / 1000).toFixed(1);
    log.push({
      at: clock(new Date(now).toISOString()),
      text: `${TX_PHASE_LABEL[current.chainPhase]} 완료 · ${seconds}s`,
      tone: 'normal',
    });
  }
  if (phase !== 'done') {
    log.push({
      at: clock(new Date(now).toISOString()),
      text: TX_PHASE_LABEL[phase],
      tone: 'normal',
    });
  }

  return {
    ...current,
    startedAt: current.startedAt ?? now,
    chainPhase: phase,
    phaseStartedAt: now,
    log,
  };
}

/** 실패로 끝났다. 어느 구간에서였는지 남긴다. */
export function applyChainFailure(current: LenderRuntime, text: string): LenderRuntime {
  const now = Date.now();
  const where = current.chainPhase === null ? '' : ` (${TX_PHASE_LABEL[current.chainPhase]})`;
  return {
    ...current,
    phase: 'rejected',
    chainPhase: null,
    log: [
      ...current.log,
      { at: clock(new Date(now).toISOString()), text: `중단${where} · ${text}`, tone: 'seal' },
    ],
  };
}

export function applyStage(
  current: LenderRuntime,
  event: {
    stage: FinancingStage;
    at: string;
    elapsedMs: number;
    block?: number;
    reason?: string;
    circuitAssert?: string | null;
  },
): LenderRuntime {
  const log = [...current.log];
  const seconds = (event.elapsedMs / 1000).toFixed(2);

  if (event.stage === 'settled') {
    log.push({ at: clock(event.at), text: `증명 완료 · ${seconds}s`, tone: 'normal' });
    log.push({
      at: clock(event.at),
      text: `확정 · 블록 ${event.block ?? '—'}`,
      tone: 'normal',
    });
  } else if (event.stage === 'rejected') {
    // 연출이 아니라 회로가 거부했다는 게 읽혀야 한다 (어느 assert에서 걸렸는지).
    const reason = event.reason ?? 'NULLIFIER_ALREADY_USED';
    const assertExpr = event.circuitAssert;
    log.push({
      at: clock(event.at),
      text: assertExpr ? `거부 · assert: ${assertExpr} · ${reason}` : `거부 · ${reason}`,
      tone: 'seal',
    });
    log.push({ at: clock(event.at), text: '지급 없음 · 예치 잔액 변동 없음', tone: 'seal' });
  } else {
    log.push({ at: clock(event.at), text: `${STAGE_TEXT[event.stage]} · ${seconds}s`, tone: 'normal' });
  }

  return {
    ...current,
    phase: event.stage,
    startedAt: current.startedAt ?? Date.now(),
    stageMs: { ...current.stageMs, [event.stage]: event.elapsedMs },
    block: event.block ?? current.block,
    log,
  };
}

export function applyRejection(
  current: LenderRuntime,
  reason: string,
  circuitAssert: string | null,
): LenderRuntime {
  return { ...current, phase: 'rejected', reason, circuitAssert };
}

export type StampState = 'idle' | 'pending' | 'settled' | 'rejected';

/**
 * 화면에 찍히는 도장은 **원장이 결정한다.**
 *
 * 진행 중인 요청이 있으면 그 단계를 보여주고, 그렇지 않으면 공개 원장에
 * 이 금융사 행이 있는지로 판단한다. 새로고침해도, 다른 창에서 신청해도
 * 같은 결과가 나온다. 로컬 state에만 의존하던 버그를 이렇게 없앤다.
 */
export function resolveStamp(runtime: LenderRuntime, loan: LoanRow | null): StampState {
  if (runtime.phase === 'rejected') return 'rejected';
  if (runtime.phase === 'settled') return 'settled';
  if (runtime.phase !== 'idle') return 'pending';
  return loan ? 'settled' : 'idle';
}

/** 진행 단계 텍스트 프로그레스바. 장식이 아니라 단계 수의 표현이다. */
export function progressBar(phase: LenderRuntime['phase']): string {
  const order: (LenderRuntime['phase'])[] = ['witness', 'proving', 'submitting', 'settled'];
  const index = order.indexOf(phase);
  const filled = phase === 'rejected' ? 0 : index + 1;
  const total = order.length;
  return '█'.repeat(Math.max(filled, 0)) + '░'.repeat(Math.max(total - filled, 0));
}
