'use client';

import type { LenderId, LoanRow } from '@/shared/api/types';
import type { FinancingStage } from '@/shared/sse/use-once-events';

export interface LogLine {
  readonly at: string;
  readonly text: string;
  readonly tone: 'normal' | 'seal';
}

/** 진행 중인 요청의 실시간 상태. 확정 이후에는 원장이 진실이다. */
export interface LenderRuntime {
  readonly phase: FinancingStage | 'idle';
  readonly startedAt: number | null;
  readonly stageMs: Partial<Record<FinancingStage, number>>;
  readonly block: number | null;
  readonly reason: string | null;
  readonly log: readonly LogLine[];
}

export const IDLE_RUNTIME: LenderRuntime = {
  phase: 'idle',
  startedAt: null,
  stageMs: {},
  block: null,
  reason: null,
  log: [],
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
    log: [{ at: clock(at), text: '대출 신청 접수', tone: 'normal' }],
  };
}

export function applyStage(
  current: LenderRuntime,
  event: { stage: FinancingStage; at: string; elapsedMs: number; block?: number },
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
    log.push({ at: clock(event.at), text: `거부 · NULLIFIER_ALREADY_USED`, tone: 'seal' });
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

export function applyRejection(current: LenderRuntime, reason: string): LenderRuntime {
  return { ...current, phase: 'rejected', reason };
}

export type StampState = 'idle' | 'pending' | 'settled' | 'rejected';

/**
 * 화면에 찍히는 도장은 **원장이 결정한다.**
 *
 * 진행 중인 요청이 있으면 그 단계를 보여주고, 그렇지 않으면 공개 원장에
 * 이 금융사 행이 있는지로 판단한다. 새로고침해도, 다른 창에서 신청해도
 * 같은 결과가 나온다 — 로컬 state에만 의존하던 버그를 이렇게 없앤다.
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
