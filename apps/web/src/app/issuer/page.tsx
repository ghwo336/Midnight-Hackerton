import type { Metadata } from 'next';
import { IssuerApp } from '@/features/issuer-app/issuer-app';

export const metadata: Metadata = {
  title: '발급 기관 · 채권 발행',
  description: '채권을 발행하면 원장에는 리프 해시 하나가 올라간다',
};

export default function Page() {
  return <IssuerApp />;
}
