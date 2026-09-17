/**
 * 회로 witness 구현과 비공개 상태.
 *
 * **Node 시뮬레이터와 브라우저가 같은 코드를 쓴다.** 사본을 두면 언젠가
 * 갈라지고, 갈라진 쪽이 회로 검사를 실제로 통과하지 않았는데 통과한 것처럼
 * 보이게 된다. 이 프로젝트에서 이미 한 번 겪은 실패라 사본을 만들지 않는다.
 *
 * 이 패키지는 브라우저에서 돈다. Node 전용 모듈을 import하지 않는다.
 */
export * from './private-state.js';
export { witnesses } from './witnesses.js';
