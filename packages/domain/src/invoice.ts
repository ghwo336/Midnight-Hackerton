import type { Hex } from './hex.js';

/** 금융사 식별자. 데모에서는 A, B 두 곳 (CONTEXT §8). */
export type LenderId = 'lender-a' | 'lender-b';

export const LENDER_IDS: readonly LenderId[] = ['lender-a', 'lender-b'];

export function isLenderId(value: string): value is LenderId {
  return (LENDER_IDS as readonly string[]).includes(value);
}

/**
 * 채권 원문. 납품업체만 보유한다.
 * 이 타입이 공개 응답·이벤트·로그에 실리는 경로가 있어서는 안 된다 (CONTEXT §4.1).
 */
export interface PrivateInvoice {
  /** 발급 기관 고유번호에서 유도. 복사·재발급해도 불변 (INV-1의 입력) */
  readonly invoiceId: Hex;
  readonly faceAmount: bigint;
  readonly salt: Hex;
  readonly ownerPk: Hex;
  /** 발급자 Merkle 트리에서의 리프 인덱스 */
  readonly leafIndex: number;
  /** 식별 정보. 어디에도 나가지 않는다. */
  readonly detail: InvoiceDetail;
  /** 위험 정보. 납품업체가 고른 항목만 해당 금융사에 간다 (CONTEXT §5) */
  readonly risk: RiskProfile;
}

/**
 * 채권을 식별하는 정보. **어디에도 공개되지 않는다.**
 *
 * 구매기업명·지급일·승인번호는 하나만 있어도 거래 상대와 규모가 드러난다.
 * 선택적 공개의 대상이 아니다. 선택지에 넣지 않는다.
 */
export interface InvoiceDetail {
  readonly counterparty: string;
  readonly dueDate: string;
  readonly approvalNumber: string;
  readonly memo: string;
}

/**
 * 심사에 쓰이는 위험 정보.
 *
 * 실제 매출채권 팩토링은 **구매기업(돈 갚을 쪽)의 신용도**로 가격을 매긴다.
 * 그게 안 보이면 금융사는 리스크를 평가할 수 없고, 심사가 아니라 자동
 * 통과가 된다.
 *
 * 그렇다고 구매기업명을 주면 거래 상대가 드러난다. 그래서 **누구인지는
 * 빼고 얼마나 위험한지만** 남긴 값들을 둔다. 등급·구간·업종은 같은 값을
 * 가진 회사가 여럿이라 하나로 특정되지 않는다.
 *
 * 납품업체가 신청할 때 항목별로 고른다. 기본은 전부 꺼짐이고, 고른 것만
 * 그 금융사에 간다 (CONTEXT §5).
 */
export interface RiskProfile {
  /** 채무자 신용등급. 구매기업의 등급이지 납품업체의 것이 아니다. */
  readonly creditGrade: string;
  /** 지급 예정일 구간. 정확한 날짜가 아니라 범위다. */
  readonly dueWindow: string;
  readonly industry: string;
}

export const DISCLOSURE_FIELDS = ['creditGrade', 'dueWindow', 'industry'] as const;

export type DisclosureField = (typeof DISCLOSURE_FIELDS)[number];

export const DISCLOSURE_LABEL: Record<DisclosureField, string> = {
  creditGrade: '채무자 신용등급',
  dueWindow: '지급 예정일 구간',
  industry: '업종 분류',
};

export function isDisclosureField(value: string): value is DisclosureField {
  return (DISCLOSURE_FIELDS as readonly string[]).includes(value);
}

/**
 * 고른 항목만 남긴다.
 *
 * 고르지 않은 항목은 빈 문자열이 아니라 **키 자체가 없다.** 값을 비워
 * 두면 응답에 키가 남고, 화면이 그걸 "비공개"로 그리게 된다. 없는 것은
 * 그냥 없어야 한다.
 */
export function selectDisclosure(
  risk: RiskProfile,
  /**
   * 없으면 아무것도 내주지 않는다.
   *
   * 빠뜨렸을 때 전부 공개되는 쪽으로 열리면, 호출부 한 곳을 고치지 않은
   * 실수가 곧 정보 유출이 된다. 닫히는 쪽이 기본이어야 한다.
   */
  fields?: readonly DisclosureField[],
): Partial<RiskProfile> {
  if (!fields || fields.length === 0) return {};
  const out: Record<string, string> = {};
  for (const field of DISCLOSURE_FIELDS) {
    if (fields.includes(field)) out[field] = risk[field];
  }
  return out as Partial<RiskProfile>;
}

/**
 * 납품업체 화면에 보여줄 최소 정보.
 * 다른 금융사 패널과 공개 원장에는 전달조차 하지 않는다 (DESIGN §5.2).
 */
export interface SupplierInvoiceView {
  readonly invoiceId: Hex;
  readonly faceAmount: string;
  readonly maxLoanAmount: string;
  readonly used: boolean;
  /**
   * 어느 금융사가 언제 썼는지. 공개 원장에서 읽어온 값이다.
   * 채권 원문이 아니라 원장에 이미 공개된 사실만 담는다 (CONTEXT §5).
   */
  readonly usedBy: LenderId | null;
  readonly usedBlock: number | null;
  /**
   * 위험 정보. 납품업체 본인 화면에는 보인다 — 자기 채권이고, 무엇을
   * 내줄지 고르려면 무엇이 있는지 알아야 한다. 고르기 전에는 아무 데도
   * 가지 않는다.
   */
  readonly risk: RiskProfile;
}

/** 담보 한도. 정수 연산만 사용한다 (SPEC §0.1-3). */
export function maxLoanAmount(faceAmount: bigint, ltvBps: bigint): bigint {
  return (faceAmount * ltvBps) / 10_000n;
}

/** 회로의 `amount * 10000 <= faceAmount * ltvBps`와 같은 판정. */
export function isWithinLtv(amount: bigint, faceAmount: bigint, ltvBps: bigint): boolean {
  return amount * 10_000n <= faceAmount * ltvBps;
}
