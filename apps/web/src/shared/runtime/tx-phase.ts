/**
 * 트랜잭션이 지나는 구간.
 *
 * 꾸며낸 단계가 아니다. 각각 실제로 다른 것을 기다린다 — 증명은 proof
 * server, 잔액 조정과 서명은 지갑(사용자 승인), 확정은 블록이다.
 * 실측 결과 한 건당 30~45초가 걸리고 그중 대부분이 승인과 확정 대기다.
 * 어느 구간에 있는지 보이지 않으면 멈춘 건지 진행 중인지 알 수 없다.
 *
 * Midnight SDK 를 끌어오지 않는 자리에 둔다. 지갑 없이 도는 화면이
 * 이 타입만 쓰려고 10MB 를 받게 하지 않는다.
 */
export type TxPhase =
  | 'preparing'
  | 'proving'
  | 'balancing'
  | 'submitting'
  | 'confirming'
  | 'done';

export const TX_PHASE_LABEL: Record<TxPhase, string> = {
  preparing: '준비 중',
  proving: '증명 생성 중',
  balancing: '지갑 승인 대기',
  submitting: '트랜잭션 제출 중',
  confirming: '블록 확정 대기',
  done: '완료',
};

/** 진행 막대를 그릴 순서. */
export const TX_PHASE_ORDER: readonly TxPhase[] = [
  'preparing', 'proving', 'balancing', 'submitting', 'confirming', 'done',
];

/** 구간 진행 막대. 장식이 아니라 남은 구간 수의 표현이다. */
export function phaseBar(phase: TxPhase | null): string {
  const total = TX_PHASE_ORDER.length;
  const filled = phase === null ? 0 : TX_PHASE_ORDER.indexOf(phase) + 1;
  return '█'.repeat(Math.max(filled, 0)) + '░'.repeat(Math.max(total - filled, 0));
}
