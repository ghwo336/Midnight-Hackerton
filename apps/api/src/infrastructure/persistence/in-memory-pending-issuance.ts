import { Injectable } from '@nestjs/common';
import type {
  PendingIssuance, PendingIssuanceStore,
} from '../../application/ports/pending-issuance.js';

/**
 * 준비된 발급 건을 잠시 들고 있는다.
 *
 * 확정되면 꺼내면서 지운다. 같은 건을 두 번 확정해 비공개 상태에 채권이
 * 두 개 생기는 일을 막는다 — 그러면 같은 리프를 가리키는 채권이 둘이 되고,
 * 하나를 대출한 뒤 다른 하나로 또 신청하면 화면은 미사용으로 보여준다.
 * (회로는 중복 확인값으로 막는다. 화면만 거짓말을 한다.)
 */
@Injectable()
export class InMemoryPendingIssuance implements PendingIssuanceStore {
  private readonly items = new Map<string, PendingIssuance>();

  async put(entry: PendingIssuance): Promise<void> {
    this.items.set(entry.id, entry);
  }

  async take(id: string): Promise<PendingIssuance | null> {
    const found = this.items.get(id) ?? null;
    if (found) this.items.delete(id);
    return found;
  }

  clear(): void {
    this.items.clear();
  }
}
