import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';
import type { DomainErrorCode, Hex, LenderId } from '@once/domain';

/**
 * SSE 이벤트 (SPEC §8.4).
 *
 * 페이로드는 공개 원장에 올라가는 것과 같은 수준만 담는다.
 * 채권 원문·salt·상세 정보를 넣지 않는다. A9가 이를 검증한다.
 */
export type OnceEvent =
  | { readonly type: 'invoice.issued'; readonly invoiceId: Hex }
  | {
      readonly type: 'financing.settled';
      readonly nullifier: Hex;
      readonly lender: LenderId;
      readonly amount: string;
      readonly txHash: Hex;
      readonly block: number;
    }
  | {
      readonly type: 'financing.rejected';
      readonly reason: DomainErrorCode;
      readonly lender: LenderId;
    };

@Injectable()
export class OnceEventsService {
  private readonly stream = new Subject<OnceEvent>();

  publish(event: OnceEvent): void {
    this.stream.next(event);
  }

  asObservable(): Observable<OnceEvent> {
    return this.stream.asObservable();
  }
}
