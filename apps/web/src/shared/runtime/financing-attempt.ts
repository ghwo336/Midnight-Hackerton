import type { AttemptResult } from './onchain-verdict';

/**
 * 실제 체인에서 대출 신청 한 건을 끝까지 밀어붙인다.
 *
 * 공격 재현 화면(A5·A6)이 쓴다. 화면 컴포넌트 안에 있던 흐름을 여기로 뺐다 —
 * 그 안에서 A6 가 **한 번도 체인에 제출되지 않는** 버그가 오래 숨어 있었고,
 * 컴포넌트 안에서는 테스트로 잡을 수가 없었다.
 *
 * 그 버그: 미리 준비한 신청(prepared)을 넘겨도 서버 사전 검사를 먼저 다시
 * 불렀다. A6 는 다른 금융사가 확정된 **뒤에** 이 신청을 내는 시나리오라, 사전
 * 검사가 409 NULLIFIER_ALREADY_USED 로 먼저 막고 준비해 둔 트랜잭션은 제출되지
 * 않았다. 판정은 정직하게 '판정 불가' 였지만, 체인의 실행 시점 재검사는 시험된
 * 적이 없었다.
 *
 * 그래서 prepared 가 있으면 사전 검사를 건너뛴다. 사전 검사는 UX 용이다 —
 * 진짜 방어는 체인에 있고, A6 는 바로 그 방어를 시험한다.
 *
 * SDK 를 끌어오지 않는다. 의존하는 것은 전부 deps 로 받는다.
 */

/** 서버가 준 신청 재료 중 보고에 필요한 것. */
export interface AttemptPlan {
  readonly applicationId: string;
  readonly amount: string;
  readonly nullifier: string;
  readonly receivedAt: string;
}

export interface ChainOutcome {
  readonly txHash: string;
  readonly block: number;
}

/** 서버에 결과를 알리는 내용. */
export interface ConfirmReport {
  readonly outcome: 'settled' | 'rejected';
  readonly txHash: string | null;
  readonly block: number | null;
  readonly reason: string | null;
  readonly elapsedMs: number;
}

export interface AttemptDeps<P extends AttemptPlan> {
  readonly now: () => number;
  /** 서버 사전 검사 + 회로 재료. prepared 가 없을 때만 부른다. */
  readonly prepare: () => Promise<P>;
  /** prepared 가 없을 때 쓰는 제출. 회로 실행·증명·제출·확정 대기까지. */
  readonly submit: (plan: P) => Promise<ChainOutcome>;
  /** 서버에 결과를 알린다. 던질 수 있다. */
  readonly confirm: (plan: P, report: ConfirmReport) => Promise<void>;
  /** 회로 assert 문구를 도메인 코드로. 모르면 null. */
  readonly classify: (error: unknown) => string | null;
  /** 체인에 포함됐지만 실패한 트랜잭션이면 그 상태값. 아니면 null. */
  readonly chainStatusOf: (error: unknown) => string | null;
  readonly describe: (error: unknown) => string;
  /** 사전 검사 실패를 짧게. 서버 오류 코드가 있으면 그것. */
  readonly describePrepareError: (error: unknown) => string;
}

/** 미리 준비한 신청. 재료와 제출 함수를 같이 들고 다닌다. */
export interface PreparedSubmission<P extends AttemptPlan> {
  readonly plan: P;
  readonly submit: () => Promise<ChainOutcome>;
}

export async function runFinancingAttempt<P extends AttemptPlan>(
  lender: string,
  deps: AttemptDeps<P>,
  prepared?: PreparedSubmission<P>,
): Promise<AttemptResult> {
  const startedAt = deps.now();
  const elapsed = () => deps.now() - startedAt;

  let plan: P;
  if (prepared) {
    plan = prepared.plan;
  } else {
    try {
      plan = await deps.prepare();
    } catch (error: unknown) {
      // 사전 검사에서 걸렸다. 회로까지 가지 않았으므로 code 를 비운다.
      return {
        lender, settled: false, code: null, detail: deps.describePrepareError(error),
        txHash: null, block: null, ms: elapsed(), startedAt, endedAt: deps.now(),
        confirmError: null, chainStatus: null,
      };
    }
  }

  /*
   * 서버 보고의 실패를 삼키지 않는다.
   *
   * 예전에는 .catch(() => undefined) 였다. 그 사이 서버가 성공 보고를 전부
   * 거절하고 있었는데(txHash 형식 검사) 아무도 몰랐다 — 금융사 화면의 신청
   * 기록이 비어 있는 이유가 화면 어디에도 없었다. 체인 결과는 바뀌지 않으므로
   * 판정은 그대로 두고, 실패 사유만 결과에 남긴다.
   */
  const report = async (r: Omit<ConfirmReport, 'elapsedMs'>): Promise<string | null> => {
    try {
      await deps.confirm(plan, { ...r, elapsedMs: elapsed() });
      return null;
    } catch (error: unknown) {
      return deps.describe(error);
    }
  };

  try {
    const out = prepared ? await prepared.submit() : await deps.submit(plan);
    const confirmError = await report({
      outcome: 'settled', txHash: out.txHash, block: out.block, reason: null,
    });
    return {
      lender, settled: true, code: null, detail: null,
      txHash: out.txHash, block: out.block, ms: elapsed(), startedAt, endedAt: deps.now(),
      confirmError, chainStatus: null,
    };
  } catch (error: unknown) {
    const code = deps.classify(error);
    const chainStatus = deps.chainStatusOf(error);
    const confirmError = await report({
      outcome: 'rejected', txHash: null, block: null, reason: code,
    });
    return {
      lender, settled: false, code,
      detail: code === null ? deps.describe(error) : null,
      txHash: null, block: null, ms: elapsed(), startedAt, endedAt: deps.now(),
      confirmError, chainStatus,
    };
  }
}

/**
 * A6 의 지연 제출이 **체인에서** 중복 확인값 때문에 거부됐는가.
 *
 * 미사용 시점에 회로를 실행하고 증명까지 만든 트랜잭션을, 다른 금융사가
 * 확정된 뒤에 낸다. 그 트랜잭션의 공개 트랜스크립트는 "이 nullifier 는
 * 미사용" 이라고 적고 있다. 노드가 실행 시점의 원장으로 다시 보고 거부해야
 * 한다 — 이게 A6 가 시험하는 성질이다.
 *
 * 노드의 거부 문구에는 회로의 assert 문구("nullifier already used")가 없다.
 * 그 문구는 로컬 회로 실행에서만 나온다. 그래서 문구 대신 **증거**로 판정한다.
 *
 *   1. 체인이 실행했고 실패로 기록했다 (트랜잭션 상태가 성공이 아니다)
 *   2. 원장에 그 nullifier 의 대출이 정확히 한 건이고, 셋업 금융사의 것이다
 *
 * 상태값은 **FailFallible 만** 받는다. 처음엔 반대로 짰다 — finance 에
 * checkpoint 가 없으니 원장 연산이 guaranteed 구간에 있고 실패하면 FailEntirely
 * 라는 소스 조사를 믿었다. 실제 체인은 달랐다. 2026-09-26 연습용 컨트랙트에서
 * 미리 만든 증명을 셋업 확정 8블록 뒤에 냈더니 인덱서 기록이 이랬다.
 *
 *   tx c2365879…58b2bf63  status PARTIAL_SUCCESS
 *   segments 0 ✓ · 1 ✓ · 16641 ✗   contractActions []
 *
 * 수수료가 든 세그먼트는 성공했고, 컨트랙트 호출이 든 세그먼트만 실패해 아무
 * 효과도 남기지 않았다. 컨트랙트 호출은 intent 마다 따로 붙는 세그먼트에
 * 들어가고, 그게 실패하면 FailFallible(부분 성공)이다. 반대로 FailEntirely 는
 * 수수료 쪽(guaranteed)이 실패했다는 뜻이라 회로 검사까지 가지도 않은 것이다.
 * 금융사 B 의 예치 잔액도 그대로였다.
 *
 * 둘 다 맞으면 NULLIFIER_ALREADY_USED 로 친다. 미사용 시점과 제출 시점 사이에
 * 바뀐 원장 읽기는 `usedNullifiers.member(nf)` 하나뿐이다 — 등록 금융사,
 * 채권 루트, 제출 금융사의 예치 잔액은 그대로다. 그러니 실행 시점 실패의 원인이
 * 될 수 있는 것은 그것뿐이다.
 *
 * 체인이 실행했다는 증거가 없으면(제출 단계 오류, 확정 대기 타임아웃) 통과로
 * 세지 않는다. 지갑 문제로 죽은 것을 통과로 세면 아무것도 시험하지 않고
 * 초록불을 켜는 것이다.
 */
export function judgeStaleRejection(input: {
  readonly chainStatus: string | null;
  readonly loansForNullifier: readonly { readonly lender: string }[];
  readonly setupLender: string;
}): { readonly code: 'NULLIFIER_ALREADY_USED' | null; readonly note: string } {
  if (input.chainStatus === null) {
    return {
      code: null,
      note:
        '체인이 이 트랜잭션을 실행했다는 증거가 없다. 제출 단계에서 죽었거나 블록에 ' +
        '들어오지 않았다 — 노드가 멤풀에서 거부했을 가능성이 있지만 확인되지 않았다',
    };
  }
  if (input.chainStatus !== 'FailFallible') {
    return {
      code: null,
      note:
        `체인이 실패로 기록했지만 상태가 ${input.chainStatus} 다. 컨트랙트 호출 세그먼트만 ` +
        '실패하면 FailFallible 이어야 한다 — FailEntirely 는 수수료 쪽이 실패해 회로 검사까지 ' +
        '가지 않은 것이라 판정하지 않는다',
    };
  }
  const n = input.loansForNullifier.length;
  if (n !== 1) {
    return {
      code: null,
      // loans 는 nullifier 가 키라 정상이면 1건이다. 0건이면 셋업이 원장에 없다.
      note: `체인은 실패로 기록했지만 원장에 이 nullifier 의 대출이 ${n}건이다. 1건이어야 판정할 수 있다`,
    };
  }
  if (input.loansForNullifier[0]!.lender !== input.setupLender) {
    return {
      code: null,
      // loans 는 nullifier 가 키라 지연 신청이 확정됐다면 기록을 덮어쓴다 — 이게 이중 담보의 흔적이다.
      note: `원장의 대출이 셋업 금융사(${input.setupLender})의 것이 아니다 — 지연 신청이 기록을 덮어썼을 수 있다`,
    };
  }
  return {
    code: 'NULLIFIER_ALREADY_USED',
    note:
      `체인이 실행 시점에 거부했다 (트랜잭션 상태 ${input.chainStatus} — 컨트랙트 호출 ` +
      `세그먼트만 실패). 원장의 대출은 ${input.setupLender} 1건뿐이다`,
  };
}

/**
 * 셋업 대출이 **원장에** 확정돼 있는가.
 *
 * 지갑이 오류를 냈다고 트랜잭션이 안 나간 것은 아니다. 실제로 "Wallet UI
 * disconnected" 로 실패가 보고됐는데 그 대출은 블록에 들어가 있었다. 창이
 * 끊긴 것이지 제출이 끊긴 것이 아니었다. 그래서 클라이언트의 오류가 아니라
 * 원장을 본다.
 *
 * A6 에서 이게 중요한 이유: 셋업이 확정되지 않았는데 미리 만든 지연 신청을
 * 내면, nullifier 가 비어 있으므로 체인이 **정상 대출로 받아 준다.** 시험은
 * 못 하고 채권만 하나 쓴다. 실제로 연습용 컨트랙트에서 그렇게 채권 하나를
 * 잃었다. 원본에서였다면 남은 두 건 중 하나였다.
 */
export function setupSettledOnLedger(input: {
  readonly loans: readonly { readonly nullifier: string; readonly lender: string }[];
  readonly nullifier: string;
  readonly setupLender: string;
}): boolean {
  const nf = input.nullifier.toLowerCase();
  return input.loans.some(
    (loan) => loan.nullifier.toLowerCase() === nf && loan.lender === input.setupLender,
  );
}
