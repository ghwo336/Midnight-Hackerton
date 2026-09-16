import {
  persistentHash,
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
} from '@midnight-ntwrk/compact-runtime';
import { bytesToHex, hexToBytes, type Hex } from '@once/domain';

/**
 * 회로가 쓰는 해시와 **완전히 동일한** TS 구현 (SPEC §7).
 *
 * Compact의 `persistentHash<Vector<n, Bytes<32>>>(xs)`는 런타임의
 * `persistentHash(new CompactTypeVector(n, new CompactTypeBytes(32)), xs)`와
 * 같은 함수다. 두 경로가 같은 값을 내는지는 S1 라운드트립 테스트가 강제한다.
 */
const BYTES32 = new CompactTypeBytes(32);

const vectorTypeCache = new Map<number, CompactTypeVector<Uint8Array>>();

function vectorType(n: number): CompactTypeVector<Uint8Array> {
  const cached = vectorTypeCache.get(n);
  if (cached) return cached;
  const created = new CompactTypeVector<Uint8Array>(n, BYTES32);
  vectorTypeCache.set(n, created);
  return created;
}

/** Compact의 `persistentHash<Vector<n, Bytes<32>>>` */
export function hashBytes32Vector(parts: readonly Uint8Array[]): Hex {
  for (const part of parts) {
    if (part.length !== 32) {
      throw new TypeError('every hash input must be exactly 32 bytes');
    }
  }
  return bytesToHex(persistentHash(vectorType(parts.length), [...parts]));
}

/** Compact의 `pad(32, "...")` — UTF-8 바이트를 오른쪽 0으로 채운다. */
export function padTag(tag: string): Uint8Array {
  const encoded = new TextEncoder().encode(tag);
  if (encoded.length > 32) {
    throw new TypeError('domain tag must not exceed 32 bytes');
  }
  const out = new Uint8Array(32);
  out.set(encoded);
  return out;
}

/** Compact의 `x as Field as Bytes<32>` */
export function amountToBytes32(amount: bigint): Uint8Array {
  if (amount < 0n) throw new TypeError('amount must not be negative');
  return convertFieldToBytes(32, amount, 'packages/crypto amountToBytes32');
}

export function hexToBytes32(value: Hex): Uint8Array {
  const bytes = hexToBytes(value);
  if (bytes.length !== 32) throw new TypeError('value must be 32 bytes');
  return bytes;
}

/** 회로의 도메인 태그. once.compact와 문자열이 일치해야 한다. */
export const TAG = {
  OWNER_PK: 'ONCE/owner-pk',
  ISSUER_PK: 'ONCE/issuer-pk',
  LEAF: 'ONCE/leaf',
  NULLIFIER: 'ONCE/nf',
  COMMITMENT: 'ONCE/cm',
  FUNDING: 'ONCE/funding',
} as const;
