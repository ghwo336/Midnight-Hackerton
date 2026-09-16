import { webcrypto } from 'node:crypto';
import { bytesToHex, type Hex } from '@once/domain';

/**
 * salt는 채권마다 새로 만든다. 재사용 금지 (SPEC §7.2).
 * 저장소에서 유일성 제약을 함께 건다.
 */
export function generateSalt(): Hex {
  return bytesToHex(webcrypto.getRandomValues(new Uint8Array(32)));
}

export function generateSecretKey(): Hex {
  return bytesToHex(webcrypto.getRandomValues(new Uint8Array(32)));
}
