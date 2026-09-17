import { describe, expect, it } from 'vitest';
import {
  CHECK_ASSERT,
  CIRCUIT_CHECK_ORDER,
  REVIEW_CHECKS,
  reviewChecklist,
  type ReviewCheck,
} from '../src/review.js';

/**
 * 체크리스트가 거짓 초록을 만들지 않는지 본다.
 *
 * 이 프로젝트에서 제일 위험한 실패는 "검사하지 않았는데 통과로 보이는 것"이다.
 * 아래 단언은 전부 그 한 가지를 막기 위한 것이다.
 */
describe('reviewChecklist', () => {
  it('확정된 신청만 네 검사가 모두 회로 통과다', () => {
    const list = reviewChecklist(null);
    for (const check of REVIEW_CHECKS) {
      expect(list[check]).toEqual({ state: 'pass', by: 'circuit' });
    }
  });

  it('회로가 앞 단계에서 멈추면 뒷 검사는 통과가 아니라 미평가다', () => {
    const list = reviewChecklist('AMOUNT_EXCEEDS_LTV');
    expect(list.limit).toEqual({ state: 'fail', by: 'circuit' });
    // 한도 뒤에 있는 미사용 검사는 실행되지 않았다
    expect(list.unused).toEqual({ state: 'skipped', by: null });
  });

  it('리프 불일치는 소유권과 발급 기관 인증을 구분하지 않는다', () => {
    for (const reason of ['OWNERSHIP_VERIFY_FAILED', 'ISSUER_ATTESTATION_FAILED'] as const) {
      const list = reviewChecklist(reason);
      expect(list.ownership.state).toBe('fail');
      expect(list.issuer.state).toBe('fail');
      // 둘 중 하나를 통과로 칠하면 어느 필드가 틀렸는지 알려주는 오라클이 된다
      expect(list.limit.state).toBe('skipped');
      expect(list.unused.state).toBe('skipped');
    }
  });

  it('중복 거부는 앞 세 검사가 회로 통과다', () => {
    const list = reviewChecklist('NULLIFIER_ALREADY_USED');
    expect(list.ownership).toEqual({ state: 'pass', by: 'circuit' });
    expect(list.issuer).toEqual({ state: 'pass', by: 'circuit' });
    expect(list.limit).toEqual({ state: 'pass', by: 'circuit' });
    expect(list.unused).toEqual({ state: 'fail', by: 'circuit' });
  });

  it('사전 검사 거부는 회로가 확인하지 않은 것을 통과로 표시하지 않는다', () => {
    const list = reviewChecklist('NULLIFIER_ALREADY_USED', 'pre-check');
    // 회로가 실행되지 않았으므로 소유권·발급 기관 인증은 아무도 보지 않았다
    expect(list.ownership).toEqual({ state: 'skipped', by: null });
    expect(list.issuer).toEqual({ state: 'skipped', by: null });
    expect(list.unused).toEqual({ state: 'fail', by: 'pre-check' });
    // 통과한 것도 회로가 아니라 사전 검사가 본 것이다
    expect(list.limit).toEqual({ state: 'pass', by: 'pre-check' });
  });

  it('금융사 미등록은 미사용 검사에 도달하지 못한다', () => {
    const list = reviewChecklist('LENDER_NOT_REGISTERED');
    expect(list.limit).toEqual({ state: 'pass', by: 'circuit' });
    expect(list.unused).toEqual({ state: 'skipped', by: null });
  });

  it('회로 밖 오류는 어떤 검사도 통과로 만들지 않는다', () => {
    for (const reason of ['PROOF_GENERATION_FAILED', 'CHAIN_SUBMIT_FAILED'] as const) {
      const list = reviewChecklist(reason);
      for (const check of REVIEW_CHECKS) expect(list[check].state).toBe('skipped');
    }
  });

  it('통과로 표시된 검사는 반드시 판정자가 있다', () => {
    const reasons = [
      null, 'NULLIFIER_ALREADY_USED', 'AMOUNT_EXCEEDS_LTV', 'LENDER_NOT_REGISTERED',
      'INSUFFICIENT_LENDER_FUNDING', 'ISSUER_ATTESTATION_FAILED', 'INVOICE_NOT_FOUND',
    ] as const;
    for (const reason of reasons) {
      for (const by of ['circuit', 'pre-check'] as const) {
        const list = reviewChecklist(reason, by);
        for (const check of REVIEW_CHECKS) {
          const result = list[check];
          if (result.state === 'skipped') expect(result.by).toBeNull();
          else expect(result.by).not.toBeNull();
        }
      }
    }
  });
});

describe('회로 대조', () => {
  const source = new URL('../../../contracts/src/once.compact', import.meta.url);

  /**
   * 표시용 표현식은 `disclose()` 래퍼와 타입 인자를 벗긴 형태다.
   * 회로 원문을 같은 형태로 줄여서 대조한다. 벗기는 규칙이 없으면
   * 이 테스트는 회로가 바뀌어도 통과해 버린다.
   */
  function normalize(text: string): string {
    // disclose( ... ) 를 괄호 짝을 세어 벗긴다. 안쪽에 또 괄호가 있으므로
    // 정규식으로는 안 된다.
    let out = '';
    let index = 0;
    while (index < text.length) {
      if (!text.startsWith('disclose(', index)) {
        out += text[index];
        index += 1;
        continue;
      }
      let depth = 0;
      let cursor = index + 'disclose'.length;
      const start = cursor + 1;
      for (; cursor < text.length; cursor += 1) {
        if (text[cursor] === '(') depth += 1;
        else if (text[cursor] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      out += normalize(text.slice(start, cursor));
      index = cursor + 1;
    }
    return out.replace(/merkleTreePathRoot<[^>]*>>\(/g, 'merkleTreePathRoot(');
  }

  async function circuitText(): Promise<string> {
    const { readFile } = await import('node:fs/promises');
    return normalize(await readFile(source, 'utf8'));
  }

  it('네 검사의 assert 표현식이 회로에 실제로 있다', async () => {
    const text = await circuitText();
    for (const check of REVIEW_CHECKS) {
      expect(text, `${check}: ${CHECK_ASSERT[check]}`).toContain(CHECK_ASSERT[check]);
    }
  });

  it('평가 순서가 회로에 나타나는 순서와 같다', async () => {
    const text = await circuitText();
    const financeBody = text.slice(text.indexOf('export circuit finance('));
    const positions = CIRCUIT_CHECK_ORDER.map((check: ReviewCheck) =>
      financeBody.indexOf(CHECK_ASSERT[check]),
    );
    expect(positions.every((p) => p >= 0)).toBe(true);
    // 정렬해도 그대로여야 한다 = 배열 순서가 회로 순서다
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
