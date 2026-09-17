'use client';

import { useState } from 'react';
import { formatAmount, shortHash } from '@/shared/ui/format';
import { deployOnce, type DeployResult } from '@/shared/wallet/deploy';
import { useWallet } from './use-wallet';

/**
 * 배포 파라미터.
 *
 * 발급 기관 비밀키가 브라우저에 있다. 데모에서는 고정값을 쓰지만
 * 실제라면 발급 기관 본인 기기에서만 존재해야 한다.
 */
const DEPLOY_PARAMS = {
  issuerId: `0x${'11'.repeat(32)}`,
  issuerPk: '',
  ltvBps: 8000n,
  issuerSecret: `0x${'5e'.repeat(32)}`,
};

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
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deploy = async () => {
    if (!state.api) return;
    setDeploying(true);
    setError(null);
    try {
      const { deriveIssuerPublicKey } = await import('@/shared/wallet/issuer-key');
      setResult(
        await deployOnce(state.api, {
          ...DEPLOY_PARAMS,
          issuerPk: await deriveIssuerPublicKey(DEPLOY_PARAMS.issuerSecret),
        }),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeploying(false);
    }
  };

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
            {result ? (
              <>
                <div className="readout__row">
                  <span className="readout__key">컨트랙트</span>
                  <span className="num">{shortHash(`0x${result.contractAddress}`)}</span>
                </div>
                <div className="readout__row">
                  <span className="readout__key">배포 tx</span>
                  <span className="num">{shortHash(`0x${result.txId}`)}</span>
                </div>
                <div className="readout__row">
                  <span className="readout__key">블록</span>
                  <span className="num">{result.blockHeight}</span>
                </div>
                <div className="readout__row">
                  <span className="readout__key">소요</span>
                  <span className="num">{(result.elapsedMs / 1000).toFixed(1)}s</span>
                </div>
              </>
            ) : null}

            {error ? <p className="hint hint--error">{error}</p> : null}

            <div className="btn-row">
              <button
                type="button"
                className="btn"
                disabled={deploying || result !== null}
                onClick={() => void deploy()}
              >
                {deploying ? '배포 중 (지갑 승인 필요)' : result ? '배포 완료' : '컨트랙트 배포'}
              </button>
              <button type="button" className="btn" onClick={disconnect} disabled={deploying}>
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
