import { DemoConsole } from '@/features/demo-console/demo-console';

/**
 * 데모 콘솔. 서버 컴포넌트가 기본이고, 상호작용이 필요한 곳만
 * 'use client'다 (SPEC §9.2).
 */
export default function Page() {
  return <DemoConsole />;
}
