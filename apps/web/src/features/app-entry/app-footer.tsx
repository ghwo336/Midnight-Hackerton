import Link from 'next/link';

/**
 * 바닥 줄.
 *
 * 공개 원장은 지갑 없이 누구나 본다. 그래서 앱 안의 탭이 아니라 바깥
 * 링크다. 앱 탭에 넣으면 "우리 서비스의 한 기능"으로 읽히는데, 원장은
 * 특정 회사의 것이 아니다.
 *
 * 발표 콘솔과 검증 도구도 같은 이유로 여기 있다. 둘 다 제품이 아니다 —
 * 하나는 심사용 3분할 화면이고 하나는 우리가 주장을 확인하는 수단이다.
 * 앱 안에 탭으로 두면 납품업체가 쓰는 기능처럼 읽힌다.
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
      <Link className="appfoot__link" href="/devtools">
        검증 도구
      </Link>
    </footer>
  );
}
