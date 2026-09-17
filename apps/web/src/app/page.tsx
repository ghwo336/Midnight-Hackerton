import { AppEntry } from '@/features/app-entry/app-entry';

/**
 * 진입점. 지갑이 역할을 정한다.
 *
 * 발표용 3분할 콘솔은 /console 로 옮겼다. 실제 서비스에 "어느 역할로
 * 볼까요" 선택은 없으므로 그게 기본 화면이면 안 된다.
 */
export default function Page() {
  return <AppEntry />;
}
