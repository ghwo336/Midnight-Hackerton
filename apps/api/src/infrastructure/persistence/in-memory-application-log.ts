import { Injectable } from '@nestjs/common';
import type { LenderId } from '@once/domain';
import type {
  ApplicationLogReader, ApplicationLogWriter, ApplicationRecord,
} from '../../application/ports/application-log.js';

/**
 * 신청 큐 저장소.
 *
 * 금융사별로 나눠 담는다. 한 배열에 섞어 두고 읽을 때 거르면, 언젠가
 * 거르는 걸 빠뜨린 코드가 생긴다. 애초에 다른 금융사 것을 꺼낼 수 없게 한다.
 */
@Injectable()
export class InMemoryApplicationLog implements ApplicationLogWriter, ApplicationLogReader {
  private readonly byLender = new Map<LenderId, ApplicationRecord[]>();

  async record(entry: ApplicationRecord): Promise<void> {
    const list = this.byLender.get(entry.lender) ?? [];
    list.unshift(entry);
    this.byLender.set(entry.lender, list);
  }

  async listFor(lender: LenderId): Promise<readonly ApplicationRecord[]> {
    return this.byLender.get(lender) ?? [];
  }

  clear(): void {
    this.byLender.clear();
  }
}
