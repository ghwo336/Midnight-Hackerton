import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CIRCUIT_ASSERT, DOMAIN_ERROR_CODES } from '@once/domain';

/**
 * CIRCUIT_ASSERT가 실제 회로와 어긋나지 않게 고정한다.
 *
 * 화면 로그에 "assert: !usedNullifiers.member(nf)"를 띄우는 근거가 이 맵이다.
 * 회로를 고쳤는데 맵을 안 고치면 화면이 거짓말을 하게 되므로, once.compact
 * 원문과 대조한다.
 */
const SOURCE = readFileSync(
  new URL('../../contracts/src/once.compact', import.meta.url),
  'utf8',
);

describe('CIRCUIT_ASSERT ↔ once.compact', () => {
  it('모든 오류 코드에 항목이 있다', () => {
    for (const code of DOMAIN_ERROR_CODES) {
      expect(CIRCUIT_ASSERT).toHaveProperty(code);
    }
  });

  it('회로 assert로 표시되는 표현식은 실제 once.compact에 존재한다', () => {
    // disclose() 래핑을 벗겨 비교한다. 화면에는 읽기 쉬운 형태로 보여준다
    const normalised = SOURCE.replace(/disclose\(([^()]*)\)/g, '$1');
    for (const [code, expr] of Object.entries(CIRCUIT_ASSERT)) {
      if (expr === null) continue;
      expect(
        normalised.includes(expr),
        `${code}의 표현식 "${expr}"이 once.compact에 없다`,
      ).toBe(true);
    }
  });
});
