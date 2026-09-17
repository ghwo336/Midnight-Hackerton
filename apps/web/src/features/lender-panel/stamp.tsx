'use client';

export type StampState = 'idle' | 'pending' | 'settled' | 'rejected';

/**
 * 도장: 화면의 유일한 표현적 순간 (DESIGN §1.1, §5.3).
 *
 * nullifier는 "한 번만 찍히는 도장"이다. 제품의 개념이 곧 화면의 은유다.
 * 확정이면 도장이 내려와 찍히고, 중복이면 내려오다 멈추고 흔들린다.
 * 이 두 순간 말고 화면 어디에도 애니메이션을 넣지 않는다.
 *
 * 로딩 스피너를 쓰지 않는다. 대기는 상태 텍스트로 대체한다 (DESIGN §6).
 */
export function Stamp({ state }: { state: StampState }) {
  if (state === 'pending') {
    return (
      <div className="stampwrap">
        <div className="stamp stamp--pending">증명{'\n'}생성 중</div>
      </div>
    );
  }
  if (state === 'settled') {
    return (
      <div className="stampwrap">
        <div className="stamp stamp--settled">지급{'\n'}완료</div>
      </div>
    );
  }
  if (state === 'rejected') {
    return (
      <div className="stampwrap">
        <div className="stamp stamp--rejected">이미{'\n'}사용</div>
      </div>
    );
  }
  return (
    <div className="stampwrap">
      <div className="stamp stamp--idle" aria-hidden="true" />
    </div>
  );
}
