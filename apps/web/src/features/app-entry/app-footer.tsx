import Link from 'next/link';

/**
 * 바닥 줄.
 *
 * 공개 원장은 지갑 없이 누구나 본다. 그래서 앱 안의 탭이 아니라 바깥
 * 링크다. 앱 탭에 넣으면 "우리 서비스의 한 기능"으로 읽히는데, 원장은
 * 특정 회사의 것이 아니다.
 */
export function AppFooter() {
  return (
    <footer className="appfoot">
      <Link className="appfoot__link" href="/ledger">
        공개 원장
      </Link>
      <Link className="appfoot__link" href="/console">
        발표 콘솔
      </Link>
    </footer>
  );
}
