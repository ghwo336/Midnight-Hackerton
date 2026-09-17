'use client';

import { useCallback, useState } from 'react';
import { ApiError, api } from '@/shared/api/client';
import { RoleHeader } from '@/shared/role/role-header';
import { shortHash } from '@/shared/ui/format';

/**
 * 아직 아무 역할도 없는 계정.
 *
 * 실제 제품이라면 여기가 가입·심사 절차다. 금융사가 되려면 인가가 필요하고
 * 납품업체가 되려면 발급 기관이 채권을 발행해 줘야 한다. 데모에서는 그
 * 절차를 생략하고 바로 가져가게 한다. 생략했다는 사실은 README 의 보장
 * 범위에 적혀 있고, 화면에서 그럴듯하게 꾸미지 않는다.
 */
export function RoleClaim({
  address,
  onClaimed,
  onDisconnect,
}: {
  address: string;
  onClaimed: () => void;
  onDisconnect: () => void;
}) {
  const [busy, setBusy] = useState<'lender' | 'supplier' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const claim = useCallback(
    async (role: 'lender' | 'supplier') => {
      setBusy(role);
      setError(null);
      try {
        const result = await api.claimRole(address, role);
        if (!result.ok) {
          setError(
            result.reason === 'LENDER_SLOTS_TAKEN'
              ? '금융사 자리가 모두 찼다. 다른 주소가 이미 두 곳을 쓰고 있다.'
              : '등록하지 못했다.',
          );
          return;
        }
        onClaimed();
      } catch (caught: unknown) {
        setError(caught instanceof ApiError ? caught.message : '등록하지 못했다.');
      } finally {
        setBusy(null);
      }
    },
    [address, onClaimed],
  );

  return (
    <div className="roleapp">
      <RoleHeader
        role="ONCE Finance"
        product="시작하기"
        account={{
          address,
          roles: [],
          active: 'supplier',
          onSwitch: () => undefined,
          onDisconnect,
        }}
      />

      <div className="roleapp__body">
        <section className="section">
          <header className="section__head">
            <span>계정</span>
            <span className="panel__role num">{shortHash(address)}</span>
          </header>
          <div className="section__body">
            <p className="hint">
              이 주소로 아직 할 수 있는 일이 없다. 아래에서 시작한다.
            </p>
          </div>
        </section>

        <section className="section">
          <header className="section__head">
            <span>자금을 조달한다</span>
          </header>
          <div className="section__body">
            <p className="hint">
              보유한 매출채권을 담보로 금융사에 대출을 신청한다. 발급 기관이
              발행한 채권이 이 계정 앞으로 들어온다.
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="btn"
                disabled={busy !== null}
                onClick={() => void claim('supplier')}
              >
                {busy === 'supplier' ? '처리 중' : '납품업체로 시작'}
              </button>
            </div>
          </div>
        </section>

        <section className="section">
          <header className="section__head">
            <span>대출을 실행한다</span>
          </header>
          <div className="section__body">
            <p className="hint">
              들어온 신청을 심사하고 자금을 집행한다. 담보가 이미 쓰였는지는
              컨트랙트가 판정한다.
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="btn"
                disabled={busy !== null}
                onClick={() => void claim('lender')}
              >
                {busy === 'lender' ? '처리 중' : '금융사로 시작'}
              </button>
            </div>
          </div>
        </section>

        {error ? <p className="hint hint--error">{error}</p> : null}
      </div>
    </div>
  );
}
