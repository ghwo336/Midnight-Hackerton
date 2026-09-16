/**
 * 32바이트 16진 문자열. 도메인 전반의 식별자·해시 표현.
 * 의존성 없음 (SPEC §4.1).
 */
export type Hex = `0x${string}`;

const HEX32 = /^0x[0-9a-f]{64}$/;

export function isHex32(value: string): value is Hex {
  return HEX32.test(value);
}

export function assertHex32(value: string, field: string): Hex {
  if (!isHex32(value)) {
    // 값 자체를 메시지에 넣지 않는다 (SPEC §0.1-5)
    throw new TypeError(`${field} must be a 32-byte lowercase hex string`);
  }
  return value;
}

export function bytesToHex(bytes: Uint8Array): Hex {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return `0x${out}`;
}

export function hexToBytes(value: Hex): Uint8Array {
  const body = value.slice(2);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
