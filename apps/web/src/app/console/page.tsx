import type { Metadata } from 'next';
import { DemoConsole } from '@/features/demo-console/demo-console';

export const metadata: Metadata = {
  title: '발표 콘솔',
  description: '역할별 화면을 나란히 띄운다. 발표와 심사용이다',
};

/**
 * 발표 콘솔.
 *
 * 기본 진입점이 아니다. 실제 서비스에 "어느 역할로 볼까요" 선택은 없고,
 * / 는 지갑이 역할을 정하는 앱이다. 이 화면은 세 역할을 한 번에 보여줘야
 * 하는 발표·심사에서만 쓴다.
 */
export default function Page() {
  return <DemoConsole />;
}
