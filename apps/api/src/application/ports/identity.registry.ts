import type { LenderId } from '@once/domain';

/**
 * 지갑 주소 → 역할.
 *
 * 실제 서비스에는 "어느 역할로 볼까요" 선택이 없다. 계정이 역할을 정한다.
 * 그런데 지금 컨트랙트는 역할을 주소에 묶지 않는다. registeredLenders 는
 * 32바이트 키 집합이고, 채권 소유권은 ownerSecret 에, 발급 권한은
 * issuerSecret 에 묶여 있다. 주소가 나오는 자리가 없다.
 *
 * 그래서 주소를 그 키들에 잇는 계층을 여기 둔다. **이건 온체인이 아니다.**
 * 온체인으로 올리려면 회로가 주소를 받아 역할을 검사해야 하고, 그건
 * 컨트랙트 변경이다 (docs/SPIKE.md §S6 의 "금융사의 승인 행위" 참조).
 * 그때까지 이 계층은 데모용 연결고리이고, 여기 있는 정보로 보안 결정을
 * 하지 않는다. 회로는 여전히 키로 판단한다.
 */
export type RoleKind = 'issuer' | 'supplier' | 'lender';

export interface IdentityRecord {
  readonly address: string;
  readonly roles: readonly RoleKind[];
  /** 금융사인 경우 어느 쪽인지. */
  readonly lenderId: LenderId | null;
  /** 납품업체인 경우 어느 저장소를 쓰는지. */
  readonly supplierId: string | null;
}

export interface IdentityRegistry {
  resolve(address: string): Promise<IdentityRecord>;
  /** 비어 있는 금융사 자리를 하나 가져간다. 없으면 null. */
  claimLender(address: string): Promise<LenderId | null>;
  /** 납품업체가 된다. 데모에서는 저장소가 하나뿐이라 그걸 쓴다. */
  claimSupplier(address: string): Promise<string>;
  clear(): void;
}

export const IDENTITY_REGISTRY = Symbol('IDENTITY_REGISTRY');
