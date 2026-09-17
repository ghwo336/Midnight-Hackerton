'use client';

import Link from 'next/link';
import { useEmbedded } from './use-embedded';

/**
 * 역할 표시줄.
 *
 * 화면마다 지금 누구의 앱인지 맨 위에 적는다. 이 한 줄이 없으면 세 화면을
 * 나란히 띄웠을 때 어느 쪽이 무엇을 못 보는지가 읽히지 않는다.
 *
 * 역할 전환은 링크다. 탭이나 드롭다운을 쓰지 않는다. 각 화면이 독립된
 * 제품이라는 게 주소로도 드러나야 한다.
 */
export const ROLES = [
  { href: '/supplier', label: '납품업체' },
  { href: '/lender/lender-a', label: '금융사 A' },
  { href: '/lender/lender-b', label: '금융사 B' },
  { href: '/issuer', label: '발급 기관' },
  { href: '/ledger', label: '공개 원장' },
] as const;

export function RoleHeader({
  role,
  product,
  current,
}: {
  /** 누구의 화면인가. */
  role: string;
  /** 그 역할이 쓰는 앱의 이름. */
  product: string;
  /** 활성 링크 판정용 경로. */
  current: string;
}) {
  const embedded = useEmbedded();

  return (
    <header className="rolebar">
      <span className="rolebar__who">
        <span className="rolebar__role">{role}</span>
        <span className="rolebar__product">{product}</span>
      </span>

      {embedded ? (
        <a className="rolebar__open" href={current} target="_blank" rel="noreferrer">
          새 창
        </a>
      ) : (
        <nav className="rolebar__nav">
          {ROLES.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rolebar__link ${
                item.href === current ? 'rolebar__link--active' : ''
              }`}
            >
              {item.label}
            </Link>
          ))}
          <Link href="/" className="rolebar__link">
            발표 콘솔
          </Link>
        </nav>
      )}
    </header>
  );
}
