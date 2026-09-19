import { describe, expect, it } from 'vitest';
import { visibleRunner } from '../../apps/web/src/shared/runtime/devtool-visibility.js';

/**
 * 러너 노출 규칙을 고정한다.
 *
 * 실제 체인에서 시뮬레이터 러너가 보이면 안 된다. 서버가 서명하지 못해
 * 여섯 건 전부 죽고, 러너는 그 실패를 "막혔다" 로 세어 초록불을 켠다.
 * 아무것도 시험하지 않고 통과로 보이는 화면이 된다.
 */
describe('검증 도구 러너 노출', () => {
  it('시뮬레이터면 서버 서명 러너를 보여준다', () => {
    expect(visibleRunner(true)).toBe('simulator');
  });

  it('실제 체인이면 지갑 서명 러너만 보여준다', () => {
    expect(visibleRunner(false)).toBe('onchain');
  });

  /*
   * 체인이 아직 대답하지 않았을 때가 위험하다. 시뮬레이터로 가정하면
   * 실제 체인에서도 잠깐 여섯 버튼이 눌리는 상태로 떠 있게 된다.
   */
  it('아직 모르면 둘 다 보여주지 않는다', () => {
    expect(visibleRunner(undefined)).toBe('none');
    expect(visibleRunner(null)).toBe('none');
  });
});
