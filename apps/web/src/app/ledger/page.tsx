import type { Metadata } from 'next';
import { LedgerApp } from '@/features/ledger-app/ledger-app';

export const metadata: Metadata = {
  title: '공개 원장',
  description: '중복 확인값·금융사·금액·블록·tx. 채권 내용은 없다',
};

export default function Page() {
  return <LedgerApp />;
}
