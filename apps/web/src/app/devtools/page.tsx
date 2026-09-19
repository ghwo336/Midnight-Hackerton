import type { Metadata } from 'next';
import { DevTools } from '@/features/devtools/devtools';

export const metadata: Metadata = {
  title: '검증 도구',
  description: '배포와 공격 재현. 제품 화면이 아니다',
  robots: { index: false },
};

/**
 * 검증 도구.
 *
 * 제품 화면이 아니다. 진입은 푸터 링크뿐이고 앱 안에 탭으로 두지 않는다.
 */
export default function Page() {
  return <DevTools />;
}
