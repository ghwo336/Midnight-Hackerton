import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LenderApp } from '@/features/lender-app/lender-app';
import type { LenderId } from '@/shared/api/types';

export const metadata: Metadata = {
  title: '금융사 · 여신 심사',
  description: '채권 원문 없이 증명만으로 담보를 심사한다',
};

const LENDERS: readonly string[] = ['lender-a', 'lender-b'];

/**
 * 데모의 금융사는 두 곳이다 (CONTEXT §8). 그 밖의 경로는 404다.
 * 아무 문자열이나 받아 화면을 그리면 없는 금융사가 있는 것처럼 보인다.
 */
export function generateStaticParams() {
  return LENDERS.map((id) => ({ id }));
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!LENDERS.includes(id)) notFound();
  return <LenderApp lenderId={id as LenderId} />;
}
