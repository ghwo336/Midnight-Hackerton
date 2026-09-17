'use client';

/**
 * 첫 화면.
 *
 * 제품이 무엇인지 한 줄, 그리고 연결 버튼. 그게 전부다. 역할 목록도
 * 기능 소개도 두지 않는다. 처음 온 사람이 봐야 하는 것은 "여기서
 * 무엇을 하는가"와 "어떻게 시작하는가" 둘뿐이다.
 */
export function ConnectGate({
  connecting,
  message,
  hasWallet,
  onConnect,
}: {
  connecting: boolean;
  message: string | null;
  hasWallet: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="gate">
      <div className="gate__box">
        <h1 className="gate__name">ONCE Finance</h1>
        <p className="gate__line">
          매출채권을 담보로 자금을 조달한다. 같은 채권으로 두 번 대출받을 수 없다.
        </p>

        {message ? <p className="hint hint--error">{message}</p> : null}
        {!hasWallet && message === null ? (
          <p className="hint">Chrome에 Lace 지갑이 필요하다.</p>
        ) : null}

        <div className="btn-row">
          <button type="button" className="btn" disabled={connecting} onClick={onConnect}>
            {connecting ? '지갑 승인 대기 중' : '지갑 연결'}
          </button>
        </div>
      </div>
    </div>
  );
}
