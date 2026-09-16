import { Injectable } from '@nestjs/common';
import type { Hex, InvoiceDetail, LenderId, PrivateInvoice } from '@once/domain';
import type { PrivateStateRepository } from '../../application/ports/private-state.repository.js';

/**
 * 역할별로 분리된 채권 원문 저장소 (SPEC §3.1).
 *
 * 모든 조회가 supplierId를 요구한다. 금융사 세션이 납품업체의 원문에
 * 닿는 메서드는 이 클래스에 존재하지 않는다 — 심사용 상세는
 * discloseDetailTo()를 통해 해당 금융사에만, 명시적으로만 나간다.
 */
@Injectable()
export class InMemoryPrivateStateRepository implements PrivateStateRepository {
  private readonly bySupplier = new Map<string, Map<Hex, PrivateInvoice>>();
  private readonly ownerSecrets = new Map<string, Hex>();
  private readonly usedSalts = new Set<Hex>();
  /** 납품업체가 어느 금융사에 상세를 공개했는지 */
  private readonly disclosures = new Map<string, Set<LenderId>>();

  setOwnerSecret(supplierId: string, secret: Hex): void {
    this.ownerSecrets.set(supplierId, secret);
  }

  async getOwnerSecret(supplierId: string): Promise<Hex> {
    const secret = this.ownerSecrets.get(supplierId);
    if (!secret) throw new Error('supplier private state is not initialised');
    return secret;
  }

  async saveInvoice(supplierId: string, invoice: PrivateInvoice): Promise<void> {
    // salt 재사용 금지 (SPEC §7.2)
    if (this.usedSalts.has(invoice.salt)) {
      throw new Error('salt must not be reused');
    }
    this.usedSalts.add(invoice.salt);

    const store = this.bySupplier.get(supplierId) ?? new Map<Hex, PrivateInvoice>();
    store.set(invoice.invoiceId, invoice);
    this.bySupplier.set(supplierId, store);
  }

  async findInvoice(supplierId: string, invoiceId: Hex): Promise<PrivateInvoice | null> {
    return this.bySupplier.get(supplierId)?.get(invoiceId) ?? null;
  }

  async listInvoices(supplierId: string): Promise<readonly PrivateInvoice[]> {
    return [...(this.bySupplier.get(supplierId)?.values() ?? [])];
  }

  /**
   * 심사하는 금융사는 필요한 정보를 본다 (CONTEXT §5).
   * 다만 납품업체가 그 금융사에 명시적으로 공개한 경우에만이다.
   */
  async discloseDetailTo(
    supplierId: string,
    invoiceId: Hex,
    lender: LenderId,
  ): Promise<InvoiceDetail | null> {
    const invoice = await this.findInvoice(supplierId, invoiceId);
    if (!invoice) return null;
    const key = `${supplierId}:${invoiceId}`;
    const allowed = this.disclosures.get(key);
    if (!allowed?.has(lender)) return null;
    return invoice.detail;
  }

  allowDisclosure(supplierId: string, invoiceId: Hex, lender: LenderId): void {
    const key = `${supplierId}:${invoiceId}`;
    const set = this.disclosures.get(key) ?? new Set<LenderId>();
    set.add(lender);
    this.disclosures.set(key, set);
  }
}
