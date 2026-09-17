import { describe, expect, it } from 'vitest';
import { isWithinLtv, maxLoanAmount, type Hex } from '@once/domain';
import {
  computeCommitment,
  computeInvoiceLeaf,
  computeNullifier,
  deriveOwnerPublicKey,
  generateSalt,
} from '@once/crypto';

const ISSUER_ID = `0x${'11'.repeat(32)}` as Hex;
const OTHER_ISSUER = `0x${'22'.repeat(32)}` as Hex;
const INVOICE_ID = `0x${'a3'.repeat(32)}` as Hex;
const OTHER_INVOICE = `0x${'b4'.repeat(32)}` as Hex;
const OWNER_PK = deriveOwnerPublicKey(`0x${'7c'.repeat(32)}` as Hex);
const FACE = 100_000_000n;

describe('INV-1: nullifier는 (issuerId, invoiceId)에만 의존한다', () => {
  it('salt가 달라도 nullifier는 같다', () => {
    // 이것이 A2 공격을 막는 근거다: 새 salt로 재봉인해도 중복이 잡힌다
    const a = computeNullifier(ISSUER_ID, INVOICE_ID);
    const b = computeNullifier(ISSUER_ID, INVOICE_ID);
    expect(a).toBe(b);
  });

  it('호출을 100번 반복해도 같은 값이다', () => {
    const first = computeNullifier(ISSUER_ID, INVOICE_ID);
    for (let i = 0; i < 100; i += 1) {
      expect(computeNullifier(ISSUER_ID, INVOICE_ID)).toBe(first);
    }
  });

  it('computeNullifier는 인자를 2개만 받는다', () => {
    // 시그니처가 넓어지면 salt·금융사·시각이 섞여 들어갈 수 있다 (SPEC §13)
    expect(computeNullifier.length).toBe(2);
  });

  it('채권이 다르면 nullifier가 다르다', () => {
    expect(computeNullifier(ISSUER_ID, INVOICE_ID)).not.toBe(
      computeNullifier(ISSUER_ID, OTHER_INVOICE),
    );
  });

  it('발급 기관이 다르면 nullifier가 다르다', () => {
    expect(computeNullifier(ISSUER_ID, INVOICE_ID)).not.toBe(
      computeNullifier(OTHER_ISSUER, INVOICE_ID),
    );
  });
});

describe('INV-2: commitment은 salt를 포함한다', () => {
  it('salt가 다르면 commitment이 다르다', () => {
    const s1 = generateSalt();
    const s2 = generateSalt();
    const c1 = computeCommitment({ invoiceId: INVOICE_ID, faceAmount: FACE, ownerPk: OWNER_PK, salt: s1 });
    const c2 = computeCommitment({ invoiceId: INVOICE_ID, faceAmount: FACE, ownerPk: OWNER_PK, salt: s2 });
    expect(c1).not.toBe(c2);
  });

  it('같은 입력이면 commitment이 같다', () => {
    const salt = generateSalt();
    const input = { invoiceId: INVOICE_ID, faceAmount: FACE, ownerPk: OWNER_PK, salt };
    expect(computeCommitment(input)).toBe(computeCommitment(input));
  });

  it('금액이 다르면 commitment이 다르다', () => {
    const salt = generateSalt();
    expect(
      computeCommitment({ invoiceId: INVOICE_ID, faceAmount: FACE, ownerPk: OWNER_PK, salt }),
    ).not.toBe(
      computeCommitment({ invoiceId: INVOICE_ID, faceAmount: FACE + 1n, ownerPk: OWNER_PK, salt }),
    );
  });
});

describe('INV-1 vs INV-2: 입력이 다르다는 것이 설계의 핵심', () => {
  it('salt만 바꾸면 commitment은 변하지만 nullifier는 변하지 않는다', () => {
    const base = { invoiceId: INVOICE_ID, faceAmount: FACE, ownerPk: OWNER_PK };
    const c1 = computeCommitment({ ...base, salt: generateSalt() });
    const c2 = computeCommitment({ ...base, salt: generateSalt() });
    const n1 = computeNullifier(ISSUER_ID, INVOICE_ID);
    const n2 = computeNullifier(ISSUER_ID, INVOICE_ID);

    expect(c1).not.toBe(c2); // 봉인값은 달라 보이지만
    expect(n1).toBe(n2); //    중복 확인값은 같아서 거부된다
  });

  it('nullifier와 commitment은 서로 다른 값이다', () => {
    const salt = generateSalt();
    expect(computeNullifier(ISSUER_ID, INVOICE_ID)).not.toBe(
      computeCommitment({ invoiceId: INVOICE_ID, faceAmount: FACE, ownerPk: OWNER_PK, salt }),
    );
  });

  it('leaf는 salt에 무관하고 commitment과도 다르다', () => {
    const leaf = computeInvoiceLeaf({ invoiceId: INVOICE_ID, faceAmount: FACE, ownerPk: OWNER_PK });
    const cm = computeCommitment({
      invoiceId: INVOICE_ID, faceAmount: FACE, ownerPk: OWNER_PK, salt: generateSalt(),
    });
    expect(leaf).not.toBe(cm);
    expect(leaf).toBe(computeInvoiceLeaf({ invoiceId: INVOICE_ID, faceAmount: FACE, ownerPk: OWNER_PK }));
  });
});

describe('담보 한도: 정수 연산만', () => {
  it('LTV 80%를 정수로 계산한다', () => {
    expect(maxLoanAmount(100_000_000n, 8000n)).toBe(80_000_000n);
  });

  it('나누어떨어지지 않아도 내림한다', () => {
    expect(maxLoanAmount(3n, 8000n)).toBe(2n);
  });

  it('회로와 같은 판정식을 쓴다', () => {
    expect(isWithinLtv(80_000_000n, 100_000_000n, 8000n)).toBe(true);
    expect(isWithinLtv(80_000_001n, 100_000_000n, 8000n)).toBe(false);
  });
});

describe('salt 생성', () => {
  it('매번 다른 값을 만든다', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generateSalt());
    expect(seen.size).toBe(500);
  });

  it('32바이트 hex다', () => {
    expect(generateSalt()).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
