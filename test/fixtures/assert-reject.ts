import { expect } from 'vitest';

/**
 * 회로가 **의도한 assert에서** 거부했는지 확인한다.
 *
 * `.rejects.toThrow()`만 쓰면 "거부됐다"는 알지만 "왜 거부됐는지"는 모른다.
 * 실제로 이것 때문에 A3·A4가 오래 거짓 통과했다. witness 경로 길이가
 * 틀려서 회로의 발급자 인증 검사에 **도달하기도 전에** 타입 오류로 죽고
 * 있었는데, 테스트는 초록불이었다.
 *
 * 그래서 거부 테스트는 전부 이 함수를 쓴다. 회로 assert 메시지가 바뀌면
 * 여기서 깨지고, 그건 의도한 동작이다.
 */
export async function expectCircuitReject(
  run: () => Promise<unknown>,
  expectedAssert: CircuitAssert,
): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error: unknown) {
    caught = error;
  }

  if (caught === undefined) {
    throw new Error(`기대: "${expectedAssert}"로 거부. 실제: 성공했다.`);
  }

  const message = caught instanceof Error ? caught.message : String(caught);

  // 타입 오류·witness 오류는 회로 검사에 도달하지 못했다는 뜻이다.
  // 거부는 됐지만 검증하려던 것을 검증하지 못한 것이므로 실패로 본다.
  if (/type error|Failed to clone|is not a function|undefined is not/i.test(message)) {
    throw new Error(
      `회로 assert에 도달하지 못했다. 기대: "${expectedAssert}". 실제: ${message.slice(0, 160)}`,
    );
  }

  expect(message, `기대한 assert에서 거부되지 않았다`).toContain(expectedAssert);
}

/** once.compact에 실제로 존재하는 assert 메시지. 오타는 테스트 실패로 드러난다. */
export const ASSERT = {
  NULLIFIER_USED: 'nullifier already used',
  LEAF_MISMATCH: 'invoice leaf mismatch',
  NOT_ATTESTED: 'invoice not attested by issuer',
  LTV_EXCEEDED: 'amount exceeds LTV',
  LENDER_UNREGISTERED: 'lender not registered',
  LENDER_UNFUNDED: 'lender has no funding',
  INSUFFICIENT_FUNDING: 'insufficient lender funding',
  ISSUER_AUTH: 'issuer authorization failed',
} as const;

export type CircuitAssert = (typeof ASSERT)[keyof typeof ASSERT];
