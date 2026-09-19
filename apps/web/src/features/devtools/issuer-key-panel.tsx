'use client';

import { useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { EMPTY, shortHash } from '@/shared/ui/format';
import {
  KEY_FILE_WARNING, issuerKeyFileName, parseIssuerKeyFile,
  type ImportDecision,
} from '@/shared/runtime/issuer-key-file';

/**
 * 발급 기관 키 내보내기·가져오기.
 *
 * 이 키는 배포한 브라우저의 IndexedDB 에만 있다. 브라우저 데이터를 지우면
 * 그 컨트랙트의 발급 권한이 **영구히 사라진다.** 회로가
 * `assert(issuerPublicKey(issuerSecret()) == issuerPk)` 를 보고, 원장의
 * `issuerPk` 는 배포 때 고정됐기 때문에 새 키로는 채권을 넣을 수 없다.
 *
 * 나가는 것은 서명키 하나뿐이다. 채권 원문이 든 비공개 상태 저장소는
 * 여전히 내보낼 수 없고 그 경로를 만들지 않는다.
 */
type Verdict =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'done'; readonly decision: ImportDecision; readonly derivedPk: string };

const VERDICT_CLASS: Record<ImportDecision['kind'], string> = {
  match: 'status--settled',
  mismatch: 'status--wait',
  refuse: 'status--wait',
};

export function IssuerKeyPanel() {
  const chain = useQuery({ queryKey: ['chain'], queryFn: api.chain });
  const issuer = useQuery({ queryKey: ['issuer'], queryFn: api.issuer });
  const [verdict, setVerdict] = useState<Verdict>({ kind: 'idle' });
  const [exported, setExported] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const contractAddress = chain.data?.contractAddress ?? null;
  const onChainPk = issuer.data?.issuerPk ?? null;

  const doExport = useCallback(async () => {
    setVerdict({ kind: 'busy' });
    try {
      const { exportIssuerKey } = await import('@/shared/wallet/issuer-key');
      const file = await exportIssuerKey({
        network: chain.data?.network ?? '알 수 없음',
        contractAddress: contractAddress ?? '',
      });
      if (!file) {
        setVerdict({ kind: 'error', message: '이 기기에 발급 기관 비밀키가 없다' });
        return;
      }

      /*
       * 파일명에 컨트랙트 주소 앞자리를 넣는다. 여러 번 배포하고 나면
       * 파일이 여러 개가 되는데, 내용을 열어 보지 않고는 어느 것이
       * 어느 컨트랙트 것인지 알 수 없다.
       */
      const name = issuerKeyFileName(file.contractAddress);
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);

      setExported(name);
      setVerdict({ kind: 'idle' });
    } catch (error: unknown) {
      setVerdict({
        kind: 'error',
        message: error instanceof Error ? error.message : '내보내지 못했다',
      });
    }
  }, [chain.data?.network, contractAddress]);

  const doImport = useCallback(
    async (file: File) => {
      setVerdict({ kind: 'busy' });
      try {
        const parsed = parseIssuerKeyFile(await file.text());
        const { importIssuerKey } = await import('@/shared/wallet/issuer-key');
        const { decision, derivedPk } = await importIssuerKey(parsed, onChainPk);
        setVerdict({ kind: 'done', decision, derivedPk });
      } catch (error: unknown) {
        setVerdict({
          kind: 'error',
          message: error instanceof Error ? error.message : '가져오지 못했다',
        });
      }
    },
    [onChainPk],
  );

  return (
    <section className="section">
      <header className="section__head">
        <span>발급 기관 키</span>
        <span className="panel__role">
          {contractAddress ? shortHash(`0x${contractAddress}`) : EMPTY}
        </span>
      </header>
      <div className="section__body">
        <p className="hint hint--error">
          이 키는 이 브라우저에만 있다. 데이터를 지우면 이 컨트랙트의 발급 권한이
          영구히 사라진다. {KEY_FILE_WARNING}
        </p>

        <div className="readout">
          <div className="readout__row">
            <span className="readout__key">원장의 발급 기관 공개키</span>
            <span className="num">{onChainPk ? shortHash(onChainPk) : EMPTY}</span>
          </div>
          {chain.data?.simulated ? (
            <div className="readout__row">
              {/*
                시뮬레이터에서는 서버가 발급한다. 브라우저 키는 쓰이지 않으므로
                여기서 "불일치" 가 떠도 고장이 아니다.
              */}
              <span className="readout__key">참고</span>
              <span>시뮬레이터에서는 서버가 발급한다. 이 키는 쓰이지 않는다</span>
            </div>
          ) : null}
        </div>

        <div className="btn-row">
          <button
            type="button"
            className="btn"
            disabled={verdict.kind === 'busy'}
            onClick={() => void doExport()}
          >
            키 내보내기
          </button>
          <button
            type="button"
            className="btn"
            disabled={verdict.kind === 'busy'}
            onClick={() => fileInput.current?.click()}
          >
            키 가져오기
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const picked = event.target.files?.[0];
              // 같은 파일을 다시 고를 수 있게 값을 비운다.
              event.target.value = '';
              if (picked) void doImport(picked);
            }}
          />
        </div>

        {exported ? <p className="hint">내려받음 · {exported}</p> : null}

        {verdict.kind === 'error' ? (
          <p className="hint hint--error">{verdict.message}</p>
        ) : null}

        {verdict.kind === 'done' ? (
          <div className="readout">
            <div className="readout__row">
              <span className="readout__key">대조 결과</span>
              <span className={`status ${VERDICT_CLASS[verdict.decision.kind]}`}>
                {verdict.decision.kind === 'match'
                  ? '일치'
                  : verdict.decision.kind === 'refuse'
                    ? '넣지 않음'
                    : '불일치'}
              </span>
            </div>
            <div className="readout__row">
              <span className="readout__key">파일 키의 공개키</span>
              <span className="num">{shortHash(verdict.derivedPk)}</span>
            </div>
            <div className="readout__row">
              <span className="readout__key">설명</span>
              <span>{verdict.decision.message}</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
