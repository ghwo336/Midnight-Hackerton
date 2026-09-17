'use client';

import { useState } from 'react';
import type { RoleKind } from '@/shared/api/types';
import { shortHash } from '@/shared/ui/format';
import { useEmbedded } from './use-embedded';

/**
 * 앱 상단 줄.
 *
 * **역할 스위처를 두지 않는다.** 실제 서비스에 "어느 역할로 볼까요" 선택은
 * 없다. 계정이 역할을 정한다. 한 계정이 둘 이상을 가질 때만 계정 메뉴
 * 안에서 바꾼다. 그건 흔한 일이고(한 회사가 채권도 팔고 대출도 한다),
 * 데모라서 있는 장치가 아니다.
 *
 * 이 화면이 무엇을 못 보는지도 여기 적지 않는다. 실제 제품은 자기가
 * 감추는 것을 설명하지 않는다.
 */
export const ROLE_LABEL: Record<RoleKind, string> = {
  issuer: '발급 기관',
  supplier: '납품업체',
  lender: '금융사',
};

export interface AccountView {
  readonly address: string;
  /** 이 계정이 실제로 가진 역할. 하나면 메뉴를 열 이유가 없다. */
  readonly roles: readonly RoleKind[];
  readonly active: RoleKind;
  readonly onSwitch: (role: RoleKind) => void;
  readonly onDisconnect?: () => void;
}

export function RoleHeader({
  role,
  product,
  account,
}: {
  role: string;
  product: string;
  account?: AccountView;
}) {
  const embedded = useEmbedded();
  const [open, setOpen] = useState(false);
  const others = account?.roles.filter((r) => r !== account.active) ?? [];

  return (
    <header className="rolebar">
      <span className="rolebar__who">
        <span className="rolebar__role">{role}</span>
        <span className="rolebar__product">{product}</span>
      </span>

      {embedded ? (
        <a className="rolebar__open" href="." target="_blank" rel="noreferrer">
          새 창
        </a>
      ) : account ? (
        <div className="account">
          <button
            type="button"
            className="account__chip"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <span className="num">{shortHash(account.address)}</span>
          </button>

          {open ? (
            <div className="account__menu">
              <div className="account__addr num">{account.address}</div>
              {others.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="account__item"
                  onClick={() => {
                    account.onSwitch(r);
                    setOpen(false);
                  }}
                >
                  {ROLE_LABEL[r]}으로 전환
                </button>
              ))}
              {account.onDisconnect ? (
                <button
                  type="button"
                  className="account__item"
                  onClick={() => {
                    account.onDisconnect?.();
                    setOpen(false);
                  }}
                >
                  연결 해제
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
