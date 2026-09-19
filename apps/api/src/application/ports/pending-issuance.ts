import type { Hex, InvoiceDetail, RiskProfile } from '@once/domain';

/**
 * 준비됐지만 아직 체인에 올라가지 않은 발급 건.
 *
 * 실제 체인에서는 서버가 서명하지 못하므로, 발급은 두 걸음으로 나뉜다.
 * 서버가 재료를 만들어 두고(prepare), 브라우저가 지갑으로 리프를 등록한
 * 뒤(confirm), 서버가 원장에서 확인하고 비공개 상태에 커밋한다.
 *
 * **비공개 상태 커밋은 확인 뒤에 한다.** 미리 저장하면 원장에 리프가 없는
 * 채권이 납품업체 화면에 담보로 뜬다. 그걸 신청하면 회로의
 * `assert(invoiceTree.checkRoot(...))` 에서 거부되는데, 화면은 왜 거부됐는지
 * 설명할 수 없다.
 */
export interface PendingIssuance {
  readonly id: string;
  readonly supplierId: string;
  readonly invoiceId: Hex;
  readonly faceAmount: bigint;
  readonly salt: Hex;
  readonly ownerPk: Hex;
  readonly leaf: Hex;
  readonly detail: InvoiceDetail;
  readonly risk: RiskProfile;
  /** 요청 승인 경로로 들어온 경우 그 요청 식별자. 직접 발급이면 null. */
  readonly requestId: string | null;
  readonly createdAt: string;
}

export interface PendingIssuanceStore {
  put(entry: PendingIssuance): Promise<void>;
  take(id: string): Promise<PendingIssuance | null>;
  clear(): void;
}

export const PENDING_ISSUANCE = Symbol('PENDING_ISSUANCE');
