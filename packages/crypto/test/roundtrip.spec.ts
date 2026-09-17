import { describe, expect, it } from 'vitest';
import { pureCircuits } from '@once/contract';
import { bytesToHex, type Hex } from '@once/domain';
import {
  computeCommitment,
  computeInvoiceLeaf,
  computeNullifier,
  deriveIssuerPublicKey,
  deriveOwnerPublicKey,
  hexToBytes32,
} from '@once/crypto';

/**
 * S1: 회로와 TS의 해시가 일치하는가 (SPEC §2, §7.1).
 *
 * 비교 대상은 Compact 컴파일러가 once.compact에서 생성한 `pureCircuits`다.
 * 즉 회로 소스가 바뀌면 이 테스트가 즉시 깨진다.
 *
 * 이 테스트가 증명하는 것: 도메인 태그 패딩, 인자 순서, 벡터 길이,
 * bigint → Bytes<32> 인코딩이 양쪽에서 같다는 것. 해시 불일치는
 * 모든 증명을 조용히 실패시키므로 이걸 가장 먼저 만든다 (SPEC §13).
 */

const ISSUER_ID = `0x${'11'.repeat(32)}` as Hex;
const INVOICE_ID = `0x${'a3'.repeat(32)}` as Hex;
const OWNER_SECRET = `0x${'7c'.repeat(32)}` as Hex;
const ISSUER_SECRET = `0x${'5e'.repeat(32)}` as Hex;
const SALT = `0x${'d9'.repeat(32)}` as Hex;
const FACE_AMOUNT = 100_000_000n;

describe('S1 라운드트립: 회로 == TS', () => {
  it('ownerPublicKey가 일치한다', () => {
    const ts = deriveOwnerPublicKey(OWNER_SECRET);
    const circuit = bytesToHex(pureCircuits.ownerPublicKey(hexToBytes32(OWNER_SECRET)));
    expect(ts).toBe(circuit);
  });

  it('issuerPublicKey가 일치한다', () => {
    const ts = deriveIssuerPublicKey(ISSUER_SECRET);
    const circuit = bytesToHex(pureCircuits.issuerPublicKey(hexToBytes32(ISSUER_SECRET)));
    expect(ts).toBe(circuit);
  });

  it('nullifier가 일치한다', () => {
    const ts = computeNullifier(ISSUER_ID, INVOICE_ID);
    const circuit = bytesToHex(
      pureCircuits.nullifierOf(hexToBytes32(ISSUER_ID), hexToBytes32(INVOICE_ID)),
    );
    expect(ts).toBe(circuit);
  });

  it('commitment가 일치한다', () => {
    const ownerPk = deriveOwnerPublicKey(OWNER_SECRET);
    const ts = computeCommitment({
      invoiceId: INVOICE_ID,
      faceAmount: FACE_AMOUNT,
      ownerPk,
      salt: SALT,
    });
    const circuit = bytesToHex(
      pureCircuits.commitmentOf(
        hexToBytes32(INVOICE_ID),
        FACE_AMOUNT,
        hexToBytes32(ownerPk),
        hexToBytes32(SALT),
      ),
    );
    expect(ts).toBe(circuit);
  });

  it('invoiceLeaf가 일치한다', () => {
    const ownerPk = deriveOwnerPublicKey(OWNER_SECRET);
    const ts = computeInvoiceLeaf({
      invoiceId: INVOICE_ID,
      faceAmount: FACE_AMOUNT,
      ownerPk,
    });
    const circuit = bytesToHex(
      pureCircuits.invoiceLeaf(hexToBytes32(INVOICE_ID), FACE_AMOUNT, hexToBytes32(ownerPk)),
    );
    expect(ts).toBe(circuit);
  });

  it('금액 경계값에서도 일치한다', () => {
    const ownerPk = deriveOwnerPublicKey(OWNER_SECRET);
    for (const amount of [0n, 1n, 2n ** 32n, 2n ** 64n - 1n]) {
      const ts = computeInvoiceLeaf({ invoiceId: INVOICE_ID, faceAmount: amount, ownerPk });
      const circuit = bytesToHex(
        pureCircuits.invoiceLeaf(hexToBytes32(INVOICE_ID), amount, hexToBytes32(ownerPk)),
      );
      expect(ts).toBe(circuit);
    }
  });
});
