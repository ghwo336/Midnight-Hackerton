/**
 * 금액은 문자열로 받아 표시만 한다. 프론트에서 금액 산술을 하지 않는다
 * (SPEC §9.2).
 */
export function formatAmount(value: string): string {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits === '') return '—';
  return new Intl.NumberFormat('ko-KR').format(BigInt(digits));
}

/** 해시는 앞 6자 + 뒤 4자로 줄인다 (DESIGN §3.1). */
export function shortHash(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** 값이 없으면 스켈레톤 로더 대신 —를 표시한다 (DESIGN §6). */
export const EMPTY = '—';
