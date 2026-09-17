'use client';

import { formatAmount, shortHash } from '@/shared/ui/format';
import { useWallet } from './use-wallet';

/**
 * 지갑 연결 패널.
 *
 * DESIGN.md의 시각 언어를 그대로 따른다. 새 색·아이콘·모션 없음.
 *
 * 이 패널이 있는 이유는 제품 주장 때문이다. 지금까지 데모는 백엔드가
 * 대신 서명했고 README에 그 한계를 적어 두었다. 납품업체가 자기 지갑으로
 * 직접 서명하면 "채권 원문과 비밀키가 본인 기기에 있다"가 실제가 된다.
 */
export function WalletPanel() {
  const { state, connect, disconnect, hasWallet } = useWallet('preprod');

  return (
    <section className="section">
      <header className="section__head">
        <span>지갑</span>
        <span className="panel__role">
          {state.status === 'connected' ? `연결됨 · ${state.network}` : '연결 안 됨'}
        </span>
      </header>

      <div className="section__body">
        {state.status === 'connected' ? (
          <div className="readout">
            <div className="readout__row">
              <span className="readout__key">지갑</span>
              <span>{state.wallet?.name}</span>
            </div>
            <div className="readout__row">
              <span className="readout__key">주소</span>
              <span className="num">{state.address ? shortHash(state.address) : '—'}</span>
            </div>
            <div className="readout__row">
              <span className="readout__key">잔액</span>
              <span className="num">{formatAmount(state.balance ?? '0')}</span>
            </div>
            <div className="btn-row">
              <button type="button" className="btn" onClick={disconnect}>
                연결 해제
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="hint">
              {state.message ??
                (hasWallet
                  ? '납품업체 역할을 본인 지갑으로 서명하려면 연결하세요.'
                  : 'Chrome에 Lace 지갑이 필요합니다.')}
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="btn"
                disabled={state.status === 'connecting'}
                onClick={() => void connect()}
              >
                {state.status === 'connecting' ? '지갑 승인 대기 중' : '지갑 연결'}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
