'use client';

import { pureCircuits } from '@once/contract';
import {
  buildIssuerKeyFile, judgeImport,
  type ImportDecision, type IssuerKeyFile,
} from '@/shared/runtime/issuer-key-file';
import { readIssuerPublicKey, readIssuerSecret, writeIssuerSecret } from './private-state';

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

function toHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function fromHex(hex: string): Uint8Array {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * 이 기기의 발급 기관 키를 파일로 만든다. 키가 없으면 null.
 *
 * 나가는 것은 **서명키 하나뿐이다.** 채권 원문이 든 비공개 상태 저장소는
 * 여전히 내보낼 수 없다.
 */
export async function exportIssuerKey(input: {
  readonly network: string;
  readonly contractAddress: string;
}): Promise<IssuerKeyFile | null> {
  const secret = await readIssuerSecret();
  if (!secret) return null;
  const secretHex = toHex(secret);
  return buildIssuerKeyFile({
    secretKey: secretHex,
    publicKey: await deriveIssuerPublicKey(secretHex),
    network: input.network,
    contractAddress: input.contractAddress,
  });
}

/**
 * 파일의 키를 이 기기에 넣는다.
 *
 * 파일에 적힌 공개키를 믿지 않고 **비밀키에서 다시 유도해** 원장과
 * 대조한다. 적힌 값을 믿으면 틀린 키를 "일치" 로 표시할 수 있다.
 *
 * 지금 이 기기의 키가 원장과 맞는데 들어온 키가 아니면 넣지 않는다.
 * 백업이 없어 권한을 잃는 것을 막으려고 만든 기능이 바로 그 사고를
 * 내면 안 된다.
 */
export async function importIssuerKey(
  file: IssuerKeyFile,
  onChainPk: string | null,
): Promise<{ readonly decision: ImportDecision; readonly derivedPk: string }> {
  const derivedPk = await deriveIssuerPublicKey(file.issuerSecretKey);
  const decision = judgeImport({
    derivedPk,
    onChainPk,
    currentPk: await readIssuerPublicKey(),
    contractAddress: file.contractAddress,
  });

  if (decision.kind !== 'refuse') {
    await writeIssuerSecret(fromHex(file.issuerSecretKey), derivedPk);
  }
  return { decision, derivedPk };
}
