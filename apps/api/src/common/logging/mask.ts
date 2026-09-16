import { SECRET_FIELD_KEYS } from '@once/domain';

const SECRET_KEYS = new Set<string>(SECRET_FIELD_KEYS);
const MASK = '[redacted]';

/**
 * 비밀값 마스킹 (SPEC §8.6).
 *
 * 이 목록의 키는 로그에 절대 나오지 않는다:
 *   salt, ownerSecret, issuerSecret, merklePath, faceAmount,
 *   counterparty, approvalNumber, dueDate, memo, invoiceRaw, detail
 *
 * A9 테스트가 이 함수를 통과한 출력에 카나리아 문자열이 남지 않는지 확인한다.
 */
export function maskSecrets(value: unknown, depth = 0): unknown {
  if (depth > 12) return MASK;
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => maskSecrets(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEYS.has(key) ? MASK : maskSecrets(item, depth + 1);
  }
  return out;
}
