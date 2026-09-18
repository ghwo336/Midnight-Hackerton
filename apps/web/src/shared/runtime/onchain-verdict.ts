/**
 * 실제 체인에서 돌린 공격 시나리오의 판정.
 *
 * 시뮬레이터와 달리 **세 번째 결과가 있다.** 지갑이 잔액 조정에 실패하거나
 * 사용자가 승인 창을 닫으면 신청은 회로에 닿지도 못한다. 그걸 "막혔다" 로
 * 세면 아무것도 시험하지 않고 초록불을 켜는 것이고, "뚫렸다" 로 세면
 * 멀쩡한 방어를 실패로 적는다. 둘 다 거짓이므로 따로 둔다.
 */
export type AttackVerdict = 'pass' | 'fail' | 'inconclusive';

export const VERDICT_LABEL: Record<AttackVerdict, string> = {
  pass: '통과',
  fail: '실패',
  inconclusive: '판정 불가',
};

/** 신청 한 건의 결말. 회로가 낸 사유만 code 에 들어간다. */
export interface AttemptResult {
  readonly lender: string;
  readonly settled: boolean;
  /** 회로가 낸 거부 사유. 회로 밖에서 죽었으면 null. */
  readonly code: string | null;
  /** 사람이 읽는 실패 문구. 회로 밖 실패의 원인을 여기 남긴다. */
  readonly detail: string | null;
  readonly txHash: string | null;
  readonly block: number | null;
  readonly ms: number;
}

export interface AttackResult {
  readonly verdict: AttackVerdict;
  readonly note: string;
  readonly attempts: readonly AttemptResult[];
}

/**
 * A5: 같은 채권으로 두 금융사에 동시에 신청한다.
 *
 * 통과 조건은 **정확히 한 건만 확정되고, 진 쪽을 회로가 중복 확인값으로
 * 막았을 때**다. 진 쪽이 지갑 문제로 죽었다면 회로가 막았다는 증거가
 * 없으므로 판정 불가다.
 */
export function judgeA5(attempts: readonly AttemptResult[]): AttackResult {
  const settled = attempts.filter((a) => a.settled);
  const lost = attempts.filter((a) => !a.settled);

  if (settled.length >= 2) {
    return {
      verdict: 'fail',
      note: '두 건 모두 확정됐다. 같은 채권으로 두 번 자금이 나갔다',
      attempts,
    };
  }
  if (settled.length === 0) {
    return {
      verdict: 'inconclusive',
      note: `확정된 건이 없다. 회로가 막은 것이 아니다 — ${describeLosses(lost)}`,
      attempts,
    };
  }
  const blocker = lost.find((a) => a.code === 'NULLIFIER_ALREADY_USED');
  if (!blocker) {
    return {
      verdict: 'inconclusive',
      note: `한 건은 확정됐지만 진 쪽이 회로 밖에서 죽었다 — ${describeLosses(lost)}`,
      attempts,
    };
  }
  return {
    verdict: 'pass',
    note: '한 건만 확정됐고, 나머지는 회로의 중복 확인값 검사에서 막혔다',
    attempts,
  };
}

/**
 * A6: 중복 확인값이 비어 있을 때 준비한 신청을, 채워진 뒤에 제출한다.
 *
 * 통과 조건은 **뒤늦게 낸 쪽이 회로에서 막히는 것**이다. 준비 시점의
 * 원장이 아니라 실행 시점의 원장으로 판정된다는 뜻이다.
 */
export function judgeA6(setup: AttemptResult, delayed: AttemptResult): AttackResult {
  const attempts = [setup, delayed];

  if (!setup.settled) {
    return {
      verdict: 'inconclusive',
      note: `셋업 대출이 확정되지 않아 시험할 상태가 만들어지지 않았다 — ${describeLosses([setup])}`,
      attempts,
    };
  }
  if (delayed.settled) {
    return {
      verdict: 'fail',
      note: '미리 준비해 둔 신청이 그대로 확정됐다. 실행 시점 재검사가 없다',
      attempts,
    };
  }
  if (delayed.code !== 'NULLIFIER_ALREADY_USED') {
    return {
      verdict: 'inconclusive',
      note: `지연 제출이 회로 밖에서 죽었다 — ${describeLosses([delayed])}`,
      attempts,
    };
  }
  return {
    verdict: 'pass',
    note: '준비 시점에는 비어 있던 중복 확인값이 실행 시점에 다시 확인돼 막혔다',
    attempts,
  };
}

function describeLosses(attempts: readonly AttemptResult[]): string {
  const parts = attempts.map((a) => `${a.lender}: ${a.code ?? a.detail ?? '알 수 없음'}`);
  return parts.length === 0 ? '사유 없음' : parts.join(', ');
}
