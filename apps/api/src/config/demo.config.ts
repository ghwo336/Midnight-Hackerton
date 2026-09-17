import { z } from 'zod';
import type { Hex, LenderId } from '@once/domain';

/**
 * 환경변수 스키마 검증 (SPEC §8.1).
 *
 * 아래 기본 비밀키는 **공개 저장소에 적힌 더미값이다.** 같은 바이트를
 * 반복한 값이고, 로컬 회로 실행에는 실제 자산이 없으므로 무해하다.
 * 기본값을 두는 이유는 .env 없이도 데모가 뜨게 하기 위해서다.
 *
 * 테스트넷 배포는 이 값을 쓰지 않는다. apps/deploy는 기본값 없이
 * ISSUER_SECRET_KEY·SUPPLIER_SECRET_KEY를 env에서만 읽고, 없으면 중단한다.
 * 공개된 발급자 키로 배포하면 누구나 registerInvoice·fundLender를 호출할
 * 수 있어 A8(발급자 사칭 차단) 주장이 무너지기 때문이다.
 */
const hex32 = z.string().regex(/^0x[0-9a-f]{64}$/);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3011),
  LTV_BPS: z.coerce.bigint().default(8000n),
  ISSUER_SECRET_KEY: hex32.default(`0x${'5e'.repeat(32)}`),
  ISSUER_ID: hex32.default(`0x${'11'.repeat(32)}`),
  SUPPLIER_SECRET_KEY: hex32.default(`0x${'7c'.repeat(32)}`),
  /** 콤마로 여러 개를 줄 수 있다. 로컬 데모에서 포트가 자주 바뀐다. */
  WEB_ORIGIN: z.string().default('http://localhost:3000,http://localhost:3040'),
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
