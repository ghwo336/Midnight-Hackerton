import type { Metadata } from 'next';
import { SupplierApp } from '@/features/supplier-app/supplier-app';

export const metadata: Metadata = {
  title: '납품업체 · 자금 조달',
  description: '보유 채권을 담보로 자금을 조달한다. 채권 원문은 이 기기에 남는다',
};

export default function Page() {
  return <SupplierApp />;
}
