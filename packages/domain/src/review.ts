import type { DomainErrorCode } from './errors.js';

/**
 * 여신 심사 체크리스트.
 *
 * 금융사가 보는 것은 이 네 줄이 전부다. 채권 원문은 여기 없고, 이 모듈이
 * 다루는 타입 어디에도 구매기업·지급일·승인번호가 들어갈 자리가 없다
 * (CONTEXT §4.1).
 *
 * "심사하는데 내용을 모른다"가 성립하려면 체크 결과가 **사실이어야** 한다.
 * 그래서 각 검사는 통과/실패뿐 아니라 **누가 판정했는지**를 함께 들고 다닌다.
 */
export const REVIEW_CHECKS = ['issuer', 'ownership', 'limit', 'unused'] as const;

export type ReviewCheck = (typeof REVIEW_CHECKS)[number];

/** 화면 표시 순서. 사람이 읽는 순서이고, 회로 평가 순서와 다르다. */
export const CHECK_LABEL: Record<ReviewCheck, string> = {
  issuer: '발급 기관 인증',
  ownership: '소유권',
  limit: '한도 이내',
  unused: '미사용',
};

/**
 * 각 검사에 대응하는 회로 표현식. once.compact의 실제 코드를 옮긴 것이다.
 * 회로를 고치면 여기도 고쳐야 하고, 테스트가 문자열을 대조한다.
 */
export const CHECK_ASSERT: Record<ReviewCheck, string> = {
  // once.compact: assert(path.leaf == leaf, ...)
  ownership: 'path.leaf == leaf',
  // once.compact: assert(invoiceTree.checkRoot(merkleTreePathRoot(path)), ...)
  issuer: 'invoiceTree.checkRoot(merkleTreePathRoot(path))',
  // once.compact: assert(amount * 10000 <= inv.faceAmount * ltvBps, ...)
  limit: 'amount * 10000 <= inv.faceAmount * ltvBps',
  // once.compact: assert(!usedNullifiers.member(nf), ...)
  unused: '!usedNullifiers.member(nf)',
};

/**
 * 회로 안에서 실제로 평가되는 순서.
 *
 * assert는 앞에서 걸리면 뒤를 평가하지 않는다. 그래서 앞 단계에서
 * 멈춘 신청의 뒷 검사를 통과로 칠하면 거짓이 된다. 이 배열이 그 경계다.
 */
export const CIRCUIT_CHECK_ORDER: readonly ReviewCheck[] = [
  'ownership',
  'issuer',
  'limit',
  'unused',
];

/**
 * 누가 판정했는가.
 *
 * `pre-check`는 유스케이스가 회로 실행 전에 거른 경우다. 보안 경계가 아니라
 * 사용자 경험용이고, 같은 검사를 회로가 실행 시점에 다시 한다 (INV-3).
 * 화면이 둘을 구분하지 않으면 "회로가 막았다"가 검증되지 않은 주장이 된다.
 */
export type CheckVerifier = 'circuit' | 'pre-check';

export type CheckState = 'pass' | 'fail' | 'skipped';

export interface CheckResult {
  readonly state: CheckState;
  /** 평가되지 않았으면 null. */
  readonly by: CheckVerifier | null;
}

export type ReviewChecklist = Record<ReviewCheck, CheckResult>;

/** 신청이 어디까지 갔는가. */
export type ReviewOutcome = 'settled' | 'rejected';

const SKIPPED: CheckResult = { state: 'skipped', by: null };

function all(result: CheckResult): ReviewChecklist {
  return { issuer: result, ownership: result, limit: result, unused: result };
}

/**
 * 회로가 assert `failed`에서 멈췄을 때의 체크리스트.
 * 앞은 통과, 그 자리는 실패, 뒤는 미평가다.
 */
function circuitStoppedAt(failed: readonly ReviewCheck[]): ReviewChecklist {
  const firstIndex = Math.min(
    ...failed.map((check) => CIRCUIT_CHECK_ORDER.indexOf(check)),
  );
  const out = all(SKIPPED) as Record<ReviewCheck, CheckResult>;
  CIRCUIT_CHECK_ORDER.forEach((check, index) => {
    if (index < firstIndex) out[check] = { state: 'pass', by: 'circuit' };
    else if (failed.includes(check)) out[check] = { state: 'fail', by: 'circuit' };
    else out[check] = SKIPPED;
  });
  return out;
}

/**
 * 거부 사유로부터 체크리스트를 만든다.
 *
 * `reason`이 null이면 회로가 끝까지 실행됐다는 뜻이고, 그때만 네 검사가
 * 전부 회로 판정으로 통과다.
 *
 * @param reason 도메인 오류 코드. null이면 확정.
 * @param rejectedBy 거부가 회로에서 났는지 사전 검사에서 났는지.
 */
export function reviewChecklist(
  reason: DomainErrorCode | null,
  rejectedBy: CheckVerifier = 'circuit',
): ReviewChecklist {
  if (reason === null) return all({ state: 'pass', by: 'circuit' });

  if (rejectedBy === 'pre-check') {
    // 사전 검사는 순서가 다르다: 채권 존재 → 한도 → 중복.
    // 소유권·발급 기관 인증은 사전 검사에 없다. 미평가로 남는다.
    if (reason === 'INVOICE_NOT_FOUND') return all(SKIPPED);
    if (reason === 'AMOUNT_EXCEEDS_LTV') {
      return { ...all(SKIPPED), limit: { state: 'fail', by: 'pre-check' } };
    }
    if (reason === 'NULLIFIER_ALREADY_USED') {
      return {
        ...all(SKIPPED),
        limit: { state: 'pass', by: 'pre-check' },
        unused: { state: 'fail', by: 'pre-check' },
      };
    }
    return all(SKIPPED);
  }

  switch (reason) {
    /*
     * 회로는 "금액을 부풀렸다"와 "타인 채권이다"를 구분하지 않는다.
     * 리프 하나가 invoiceId·faceAmount·ownerPk를 전부 묶기 때문이다.
     * 구분해서 알려주면 어느 필드가 틀렸는지 알아내는 오라클이 된다.
     * 그래서 두 검사가 같이 실패로 표시된다. 둘 중 하나를 통과로 칠하면
     * 회로가 하지 않은 판정을 화면이 지어내는 것이다.
     */
    case 'OWNERSHIP_VERIFY_FAILED':
    case 'ISSUER_ATTESTATION_FAILED':
      return circuitStoppedAt(['ownership', 'issuer']);
    case 'AMOUNT_EXCEEDS_LTV':
      return circuitStoppedAt(['limit']);
    case 'NULLIFIER_ALREADY_USED':
      return circuitStoppedAt(['unused']);
    /*
     * 아래는 네 검사 바깥의 assert다. 금융사 등록 검사는 한도와 미사용
     * 사이에, 잔액 검사는 미사용 뒤에 있다. 그 위치까지 통과한 것만 채운다.
     */
    case 'LENDER_NOT_REGISTERED':
      return {
        ownership: { state: 'pass', by: 'circuit' },
        issuer: { state: 'pass', by: 'circuit' },
        limit: { state: 'pass', by: 'circuit' },
        unused: SKIPPED,
      };
    case 'INSUFFICIENT_LENDER_FUNDING':
      return all({ state: 'pass', by: 'circuit' });
    default:
      // 회로 밖 오류 (증명 실패, 제출 실패, 채권 없음)
      return all(SKIPPED);
  }
}
