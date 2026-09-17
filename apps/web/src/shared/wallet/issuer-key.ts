'use client';

import { pureCircuits } from '@once/contract';

/**
 * 발급 기관 공개키를 회로와 동일한 방식으로 유도한다.
 *
 * packages/crypto를 쓰지 않고 컴파일된 회로의 pureCircuits를 직접 부른다.
 * 값이 어긋날 여지를 없앤다 (S1 라운드트립이 검증하는 바로 그 지점).
 */
export async function deriveIssuerPublicKey(secretHex: string): Promise<string> {
  const body = secretHex.startsWith('0x') ? secretHex.slice(2) : secretHex;
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  const out = pureCircuits.issuerPublicKey(bytes);
  return `0x${Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
