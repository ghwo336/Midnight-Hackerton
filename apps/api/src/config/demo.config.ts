import { z } from 'zod';
import type { Hex, LenderId } from '@once/domain';

/**
 * 환경변수 스키마 검증 (SPEC §8.1).
 * ISSUER_SECRET_KEY는 데모용이며 절대 커밋하지 않는다 (SPEC §14).
 */
const hex32 = z.string().regex(/^0x[0-9a-f]{64}$/);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  LTV_BPS: z.coerce.bigint().default(8000n),
  ISSUER_SECRET_KEY: hex32.default(`0x${'5e'.repeat(32)}`),
  ISSUER_ID: hex32.default(`0x${'11'.repeat(32)}`),
  SUPPLIER_SECRET_KEY: hex32.default(`0x${'7c'.repeat(32)}`),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
});

export type OnceEnv = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): OnceEnv {
  return EnvSchema.parse(source);
}

/** 데모의 단일 납품업체. */
export const SUPPLIER_ID = 'supplier-1';
export const SUPPLIER_ADDRESS = `0x${'cc'.repeat(32)}` as Hex;

/** 금융사 식별자 → 온체인 키. 공개 값이다. */
export const LENDER_KEYS: Record<LenderId, Hex> = {
  'lender-a': `0x${'0a'.repeat(32)}` as Hex,
  'lender-b': `0x${'0b'.repeat(32)}` as Hex,
};

export const LENDER_LABELS: Record<LenderId, string> = {
  'lender-a': '금융사 A',
  'lender-b': '금융사 B',
};

export function lenderIdFromKey(key: Hex): LenderId | null {
  for (const [id, value] of Object.entries(LENDER_KEYS)) {
    if (value === key) return id as LenderId;
  }
  return null;
}

export const LENDER_FUNDING = 1_000_000_000n;
