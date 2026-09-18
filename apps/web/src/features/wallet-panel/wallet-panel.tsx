'use client';

import { useCallback, useState } from 'react';
import { formatAmount, shortHash, EMPTY } from '@/shared/ui/format';
import {
  initialSteps, runBootstrap, type StepResult,
} from '@/shared/wallet/bootstrap';
import type { Recorder } from '@/shared/wallet/measure';
import { currentNetworkId } from '@/shared/wallet/network';
import { useWallet } from './use-wallet';

/**
 * 지갑 패널 겸 배포 콘솔.
 *
 * 여기서 하는 일은 S6-b·c를 닫는 것이다.
 *
 *   S6-b  회로 증명 소요 시간을 실측한다. 배포는 finance 회로를 부르지
 *         않으므로 배포만으로는 측정되지 않는다. 금융사 등록부터가 진짜
 *         회로 호출이고, 그 단계에만 증명 시간이 찍힌다.
 *   S6-c  IndexedDB의 issuerSecret이 witness로 회로에 전달되는지 본다.
 *         회로가 issuerPublicKey(issuerSecret()) == issuerPk를 assert하므로
 *         금융사 등록이 성공하면 그 값이 IndexedDB에서 온 올바른 비밀키다.
 *
 * 증명은 브라우저 CPU가 아니라 proof server에서 일어난다. 클라이언트는
 * 증명키를 payload에 실어 보낸다. 그래서 여기 찍히는 시간은
 * "키 전송 + 서버 증명 + 응답"이다. 화면이 그렇게 적는다.
 */
const STATE_MARK: Record<StepResult['state'], string> = {
  pending: '—',
  running: '…',
  done: '✓',
  failed: '✗',
};

function ms(value: number | undefined): string {
  return value === undefined ? EMPTY : `${(value / 1000).toFixed(2)}s`;
}

export function WalletPanel() {
  const { state, connect, disconnect, hasWallet } = useWallet('preprod');
  const [steps, setSteps] = useState<readonly StepResult[]>(initialSteps());
  const [running, setRunning] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [issuerPk, setIssuerPk] = useState<string | null>(null);
  const [recorder, setRecorder] = useState<Recorder | null>(null);

  const run = useCallback(async () => {
    if (!state.api) return;
    setRunning(true);
    setSteps(initialSteps());
    try {
      const result = await runBootstrap(state.api, (next, rec) => {
        setSteps(next);
        setRecorder(rec);
      });
      setAddress(result.contractAddress);
      setIssuerPk(result.issuerPublicKey);
      setRecorder(result.recorder);
      setSteps(result.steps);
    } finally {
      setRunning(false);
    }
  }, [state.api]);

  /*
   * DUST 가 없으면 배포를 시작하지 않는다.
   *
   * 시작하면 잔액 조정 단계에서 10초를 쓰고 "could not balance dust" 로
   * 죽는다. 할 수 없는 일을 버튼으로 내놓지 않는다.
   */
  const noDust = state.status === 'connected' && (state.dust ?? '0') === '0';

  const failed = steps.find((step) => step.state === 'failed') ?? null;
  const done = steps.filter((step) => step.state === 'done').length;
  const proved = steps.filter((step) => step.provable && step.proveMs !== undefined);
  const avgProve =
    proved.length === 0
      ? null
      : proved.reduce((acc, step) => acc + (step.proveMs ?? 0), 0) / proved.length;

  const copyReport = () => {
    if (recorder) void navigator.clipboard.writeText(recorder.toReport());
  };

  return (
    <section className="section">
      <header className="section__head">
        <span>지갑 · Preprod 배포</span>
        <span className="panel__role">
          {state.status === 'connected' ? `연결됨 · ${state.network}` : '연결 안 됨'}
        </span>
      </header>

      <div className="section__body">
        {state.status === 'connected' ? (
          <>
            <div className="readout">
              <div className="readout__row">
                <span className="readout__key">지갑</span>
                <span>{state.wallet?.name}</span>
              </div>
              <div className="readout__row">
                <span className="readout__key">주소</span>
                <span className="num">{state.address ? shortHash(state.address) : EMPTY}</span>
              </div>
              <div className="readout__row">
                <span className="readout__key">잔액 (tNIGHT)</span>
                <span className="num">{formatAmount(state.balance ?? '0')}</span>
              </div>
              <div className={`readout__row ${noDust ? 'vault vault--unchanged' : ''}`}>
                {/*
                  수수료는 tNIGHT 이 아니라 DUST 로 낸다. 이게 0 이면
                  잔액이 아무리 많아도 트랜잭션을 낼 수 없다.
                */}
                <span className="readout__key">수수료 자원 (DUST)</span>
                <span className="num">
                  {formatAmount(state.dust ?? '0')} / {formatAmount(state.dustCap ?? '0')}
                </span>
              </div>
              {address ? (
                <div className="readout__row">
                  <span className="readout__key">컨트랙트</span>
                  <span className="num">{shortHash(`0x${address}`)}</span>
                </div>
              ) : null}
              <div className="readout__row">
                {/* SDK 전역 설정값. 비어 있으면 배포가 시작도 못 한다. */}
                <span className="readout__key">SDK 네트워크</span>
                <span className="num">{currentNetworkId() ?? '미설정'}</span>
              </div>
              {issuerPk ? (
                <div className="readout__row">
                  <span className="readout__key">발급 기관 공개키</span>
                  <span className="num">{shortHash(issuerPk)}</span>
                </div>
              ) : null}
              <div className="readout__row">
                <span className="readout__key">진행</span>
                <span className="num">
                  {done} / {steps.length}
                </span>
              </div>
            </div>

            <div className="stages__head">
              배포 단계 · 각 단계마다 지갑 승인이 한 번씩 뜬다
            </div>
            <table className="terms">
              <colgroup>
                <col className="c-lender" />
                <col />
                <col className="c-amount" />
                <col className="c-amount" />
              </colgroup>
              <thead>
                <tr>
                  <th />
                  <th>단계</th>
                  <th className="num">증명</th>
                  <th className="num">전체</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step) => (
                  <tr key={step.id}>
                    <td className={step.state === 'failed' ? 'check--fail' : ''}>
                      {STATE_MARK[step.state]}
                    </td>
                    <td>{step.label}</td>
                    {/*
                      배포도 proveTx 를 거친다. "회로 없음" 으로 덮어 두면
                      31초가 어디서 갔는지 볼 수 없다. 측정값을 그대로 쓴다.
                    */}
                    <td className="num">{ms(step.proveMs)}</td>
                    <td className="num">{ms(step.ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {noDust ? (
              <p className="hint hint--error">
                수수료 자원(DUST)이 0이다. 트랜잭션 수수료는 tNIGHT이 아니라
                DUST로 낸다. DUST는 보유한 tNIGHT에서 시간이 지나며 생성되므로
                잠시 뒤 다시 연결하면 값이 오른다.
              </p>
            ) : null}

            {failed ? (
              <p className="hint hint--error">
                {failed.label}에서 중단: {failed.error}
              </p>
            ) : null}

            {recorder ? (
              <div className="readout">
                <div className="readout__row">
                  <span className="readout__key">증명 평균 (회로 호출 {proved.length}건)</span>
                  <span className="num">{avgProve === null ? EMPTY : ms(avgProve)}</span>
                </div>
                <div className="readout__row">
                  <span className="readout__key">IndexedDB 비공개 상태 읽기</span>
                  <span className="num">{recorder.privateStateReads}회</span>
                </div>
                <div className="readout__row">
                  <span className="readout__key">witness 호출</span>
                  <span className="num">
                    {recorder.witnessCalls.length === 0
                      ? '없음'
                      : `${recorder.witnessCalls.length}회 · ${[
                          ...new Set(recorder.witnessCalls.map((c) => c.witness)),
                        ].join(', ')}`}
                  </span>
                </div>
              </div>
            ) : null}

            <p className="hint">
              증명은 브라우저가 아니라 proof server에서 만들어진다. 위 증명 시간은
              증명키 전송과 서버 왕복을 포함한 값이다.
            </p>
            <p className="hint">
              발급 기관 비밀키는 첫 실행 때 이 기기에서 만들어 IndexedDB에만 둔다.
              저장소에 적힌 더미 키로 배포하면 누구나 채권을 등록할 수 있다.
            </p>

            <div className="btn-row">
              <button
                type="button"
                className="btn"
                disabled={running || noDust}
                onClick={() => void run()}
              >
                {running ? '진행 중 (지갑 승인 필요)' : done > 0 ? '다시 실행' : '배포 시작'}
              </button>
              <button type="button" className="btn" disabled={!recorder} onClick={copyReport}>
                실측 복사
              </button>
              <button type="button" className="btn" onClick={disconnect} disabled={running}>
                연결 해제
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">
              {state.message ??
                (hasWallet
                  ? 'Preprod 네트워크로 설정한 Lace를 연결한다.'
                  : 'Chrome에 Lace 지갑이 필요하다.')}
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
