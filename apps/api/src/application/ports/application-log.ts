import type { DomainErrorCode, Hex, LenderId, ReviewChecklist } from '@once/domain';

/**
 * 금융사에 도착한 대출 신청 한 건.
 *
 * 이 타입에 채권 원문 필드를 추가하지 않는다. 금융사 화면이 읽는 유일한
 * 신청 정보이고, 여기에 구매기업이나 지급일이 들어가는 순간 "심사하는데
 * 내용을 모른다"가 거짓이 된다 (CONTEXT §4.1).
 *
 * `nullifier`는 회로가 disclose하는 공개값이라 담아도 된다. 금액도 원장에
 * 올라가는 공개값이다. 그 둘 말고는 검증 결과뿐이다.
 */
export interface ApplicationRecord {
  readonly id: string;
  readonly lender: LenderId;
  readonly amount: string;
  /** 회로까지 가지 못한 신청은 중복 확인값이 계산되지 않는다. */
  readonly nullifier: Hex | null;
  readonly receivedAt: string;
  readonly outcome: 'settled' | 'rejected';
  readonly checks: ReviewChecklist;
  /** 거부 사유. 확정이면 null. */
  readonly reason: DomainErrorCode | null;
  readonly block: number | null;
  readonly txHash: Hex | null;
  readonly elapsedMs: number;
}

/**
 * ISP: 기록과 조회를 나눈다 (SPEC §5).
 * 금융사 화면을 그리는 쪽이 기록 메서드에 접근할 이유가 없다.
 */
export interface ApplicationLogWriter {
  record(entry: ApplicationRecord): Promise<void>;
}

export interface ApplicationLogReader {
  /** 그 금융사에 온 신청만. 다른 금융사의 신청은 나가지 않는다. */
  listFor(lender: LenderId): Promise<readonly ApplicationRecord[]>;
}

export const APPLICATION_LOG_WRITER = Symbol('APPLICATION_LOG_WRITER');
export const APPLICATION_LOG_READER = Symbol('APPLICATION_LOG_READER');
