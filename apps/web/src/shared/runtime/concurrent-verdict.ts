/**
 * A5 판정: 같은 채권으로 두 금융사에 동시에 신청했을 때.
 *
 * **결과에서 읽는다. 미리 써 두지 않는다.**
 *
 * 예전에는 화면이 요청을 보낸 뒤 `blocked: true` 를 그냥 써 넣었다.
 * 로컬에서는 우연히 맞았지만, 두 요청이 다른 이유로 죽어도 "통과" 가
 * 떴다. 아무것도 시험하지 않고 초록불을 켜는 것이 이 패널이 가장 하면
 * 안 되는 일이라, 판정을 여기로 꺼내 테스트로 고정한다.
 *
 * 통과 조건은 하나다: **정확히 한 건만 확정된다.**
 * 둘 다 확정되면 이중 담보가 뚫린 것이고, 둘 다 실패하면 회로가 막은
 * 것이 아니라 그 앞에서 죽은 것이다. 둘 다 통과가 아니다.
 */
export interface ConcurrentVerdict {
  readonly blocked: boolean;
  readonly code: string;
  /** 실제로 나간 자금. 확정된 건수만큼이다. */
  readonly fundsMoved: string;
  readonly note: string;
}

export function judgeConcurrent(input: {
  readonly settledCount: number;
  readonly rejectedCount: number;
  /** 거부된 쪽이 낸 사유. 없으면 null. */
  readonly rejectionCode: string | null;
  /** 한 건이 확정됐을 때 나가는 금액. */
  readonly amountPerLoan: string;
}): ConcurrentVerdict {
  const { settledCount, rejectedCount, rejectionCode, amountPerLoan } = input;
  const blocked = settledCount === 1 && rejectedCount === 1;

  return {
    blocked,
    code: blocked ? (rejectionCode ?? 'NULLIFIER_ALREADY_USED') : (rejectionCode ?? 'SETTLED'),
    fundsMoved: (BigInt(amountPerLoan) * BigInt(settledCount)).toString(),
    note:
      settledCount >= 2
        ? '두 건 모두 확정됐다. 이중 담보가 막히지 않았다'
        : settledCount === 0
          ? '두 건 모두 실패했다. 회로가 막은 것이 아니다'
          : '',
  };
}
