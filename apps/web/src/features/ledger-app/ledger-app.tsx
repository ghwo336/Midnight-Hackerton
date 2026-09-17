'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { RoleHeader } from '@/shared/role/role-header';
import { useLive } from '@/shared/role/use-live';
import { EMPTY, shortHash } from '@/shared/ui/format';
import { LedgerTable } from '@/entities/loan/ledger-table';

/**
 * 공개 원장. 누구나 본다.
 *
 * 컬럼은 중복 확인값 · 금융사 · 금액 · 봉인값 · 블록 · tx · 시각뿐이다.
 * 채권 내용 필드를 렌더링하는 코드가 여기에 존재해서는 안 된다.
 * 숨기는 게 아니라 만들지 않는다 (CONTEXT §4.1).
 */
export function LedgerApp() {
  const loans = useQuery({ queryKey: ['loans'], queryFn: api.loans });
  const status = useQuery({ queryKey: ['chain'], queryFn: api.chain });
  useLive('standalone');

  const chain = status.data;
  const simulated = chain?.simulated ?? true;

  return (
    <div className="roleapp">
      <RoleHeader
        role="공개 원장"
        product="누구나 열람"
        current="/ledger"
        note="이 표에 채권 내용은 한 글자도 없다"
      />

      <div className="roleapp__body">
        <section className="section">
          <header className="section__head">
            <span>체인</span>
            <span className="panel__role">{chain?.network ?? EMPTY}</span>
          </header>
          <div className="section__body">
            <div className="readout">
              <div className="readout__row">
                <span className="readout__key">{simulated ? '순번' : '블록 높이'}</span>
                <span className="num">{chain?.blockHeight ?? EMPTY}</span>
              </div>
              <div className="readout__row">
                <span className="readout__key">
                  {simulated ? '컨트랙트 (모의)' : '컨트랙트'}
                </span>
                <span className="num">
                  {chain ? shortHash(`0x${chain.contractAddress}`) : EMPTY}
                </span>
              </div>
              <div className="readout__row">
                <span className="readout__key">확정된 대출</span>
                <span className="num">{loans.data?.length ?? 0}건</span>
              </div>
              <div className="readout__row">
                <span className="readout__key">노드</span>
                <span>{chain?.connected ? '연결됨' : '끊김'}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <header className="section__head">
            <span>대출 기록</span>
            <span className="panel__role">nullifier · 금융사 · 금액 · 블록 · tx</span>
          </header>
          <div className="section__body">
            <LedgerTable
              loans={loans.data ?? []}
              simulated={simulated}
              explorerBase={chain?.network === 'local-circuit' ? null : (chain?.network ?? null)}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
