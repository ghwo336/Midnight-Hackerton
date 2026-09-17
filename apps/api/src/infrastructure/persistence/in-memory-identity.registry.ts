import { Inject, Injectable } from '@nestjs/common';
import { LENDER_IDS, type LenderId } from '@once/domain';
import type {
  IdentityRecord, IdentityRegistry, RoleKind,
} from '../../application/ports/identity.registry.js';
import {
  PRIVATE_STATE_REPO, type PrivateStateRepository,
} from '../../application/ports/private-state.repository.js';
import { SUPPLIER_ID } from '../../config/demo.config.js';

/**
 * 주소 → 역할 등록부.
 *
 * 판별 순서는 "이 주소가 이미 무엇을 했는가"를 따른다.
 *   1. 금융사로 등록된 주소인가
 *   2. 이 주소 앞으로 발행된 채권이 있는가
 * 발급 기관은 여기서 판별하지 않는다. 발급 권한은 issuerSecret 을 쥐고
 * 있느냐로 정해지고 그 키는 브라우저에만 있다. 서버가 안다고 말할 수 없다.
 */
@Injectable()
export class InMemoryIdentityRegistry implements IdentityRegistry {
  private readonly lenderOf = new Map<string, LenderId>();
  private readonly suppliers = new Set<string>();

  constructor(
    @Inject(PRIVATE_STATE_REPO) private readonly privateState: PrivateStateRepository,
  ) {}

  private normalise(address: string): string {
    return address.trim().toLowerCase();
  }

  async resolve(address: string): Promise<IdentityRecord> {
    const key = this.normalise(address);
    const roles: RoleKind[] = [];

    const lenderId = this.lenderOf.get(key) ?? null;
    if (lenderId !== null) roles.push('lender');

    // 채권을 들고 있으면 납품업체다. 등록 여부보다 보유 사실이 앞선다.
    const isSupplier =
      this.suppliers.has(key) &&
      (await this.privateState.listInvoices(SUPPLIER_ID)).length > 0;
    if (isSupplier) roles.push('supplier');

    return {
      address: key,
      roles,
      lenderId,
      supplierId: isSupplier ? SUPPLIER_ID : null,
    };
  }

  async claimLender(address: string): Promise<LenderId | null> {
    const key = this.normalise(address);
    const existing = this.lenderOf.get(key);
    if (existing) return existing;

    const taken = new Set(this.lenderOf.values());
    const free = LENDER_IDS.find((id) => !taken.has(id));
    if (!free) return null;

    this.lenderOf.set(key, free);
    return free;
  }

  async claimSupplier(address: string): Promise<string> {
    this.suppliers.add(this.normalise(address));
    return SUPPLIER_ID;
  }

  clear(): void {
    this.lenderOf.clear();
    this.suppliers.clear();
  }
}
