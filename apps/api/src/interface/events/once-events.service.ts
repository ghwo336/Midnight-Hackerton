import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';
import type { DomainErrorCode, Hex, LenderId } from '@once/domain';

/**
 * SSE 이벤트 (SPEC §8.4).
 *
 * 페이로드는 공개 원장에 올라가는 것과 같은 수준만 담는다.
 * 채권 원문·salt·상세 정보를 넣지 않는다. A9가 이를 검증한다.
 */
/**
 * 진행 단계. 실제 전이 시점에만 발행한다.
 * 화면을 채우려고 인위적 지연을 넣지 않는다 — 로컬 실행이 빠르면 빠른 대로
 * 보여야 테스트넷에서 느려졌을 때 그게 사실로 읽힌다.
 */
export type FinancingStage = 'witness' | 'proving' | 'submitting' | 'settled' | 'rejected';

export type OnceEvent =
  | { readonly type: 'invoice.issued'; readonly invoiceId: Hex }
  | {
      readonly type: 'financing.stage';
      readonly lender: LenderId;
      readonly stage: FinancingStage;
      readonly at: string;
      readonly elapsedMs: number;
      readonly block?: number;
    }
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
      /** 어느 회로 assert에서 걸렸는지. 회로 밖 오류면 null. */
      readonly circuitAssert: string | null;
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
