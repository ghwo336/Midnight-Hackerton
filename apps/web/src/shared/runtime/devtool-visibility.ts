/**
 * 어느 공격 러너를 보여줄 것인가.
 *
 * 두 러너는 서명하는 주체가 다르다. 시뮬레이터 러너는 서버가 서명하고,
 * 실제 체인 러너는 사용자 지갑이 서명한다. 그래서 한쪽에서 다른 쪽은
 * 아예 돌지 않는다.
 *
 * **모르는 동안에는 둘 다 보여주지 않는다.** 체인이 아직 대답하지
 * 않았는데 시뮬레이터로 가정하면, 실제 체인에서 돌지 않는 버튼 여섯 개가
 * 눌리는 상태로 잠깐 떠 있게 된다. 눌러봐야 서버가 서명하지 못해 전부
 * 죽는데, 러너는 그 실패를 "막혔다" 로 세어 초록불을 켠다.
 *
 * 한때는 문구로 때웠다 — "실제 체인에서는 이 러너가 돌지 않는다" 를 띄운
 * 채로 버튼을 남겨 뒀다. 못 쓴다고 적어 놓고 누를 수 있게 두는 것은
 * 모순이다. 보이지 않게 하는 것이 맞다.
 */
export type RunnerKind = 'onchain' | 'simulator' | 'none';

export function visibleRunner(simulated: boolean | null | undefined): RunnerKind {
  if (simulated === true) return 'simulator';
  if (simulated === false) return 'onchain';
  return 'none';
}
