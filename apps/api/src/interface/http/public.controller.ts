import { Controller, Get, Inject, Sse } from '@nestjs/common';
import { LENDER_IDS } from '@once/domain';
import { CHAIN_READER, type ChainReader } from '../../application/ports/chain.gateway.js';
import { map, type Observable } from 'rxjs';
import { ListLoansUseCase } from '../../application/list-loans.usecase.js';
import { OnceEventsService } from '../events/once-events.service.js';
import { LENDER_LABELS } from '../../config/demo.config.js';

/**
 * 공개 원장: 읽기 전용.
 *
 * 이 컨트롤러가 반환하는 것은 nullifier · 금융사 · 금액 · commitment ·
 * 블록 · tx뿐이다. 채권 원문 필드를 담는 코드가 여기에 존재해서는 안 된다
 * (CONTEXT §4.1, DESIGN §4.1).
 */
@Controller('public')
export class PublicController {
  constructor(
    @Inject(ListLoansUseCase) private readonly listLoans: ListLoansUseCase,
    @Inject(OnceEventsService) private readonly events: OnceEventsService,
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
  ) {}

  /** 상단 상태줄용. 체인 이름을 과장하지 않는다. */
  @Get('chain')
  async chain() {
    return this.reader.getStatus();
  }

  @Get('loans')
  async loans() {
    return { loans: await this.listLoans.execute() };
  }

  /**
   * 금융사 취급 조건.
   *
   * 납품업체가 어디에 신청할지 고르려면 이 정보가 필요하다. 그렇다고
   * 납품업체 화면이 /lender/:id 를 부르게 하면 금융사 내부 신청 큐까지
   * 딸려 온다. 그래서 공개값만 담은 경로를 따로 둔다.
   *
   * 예치 잔액은 원장의 lenderVault다. 담보인정비율은 컨트랙트 전역 값이라
   * 금융사마다 다르지 않다. 없는 조건을 지어내지 않는다.
   */
  @Get('lenders')
  async lenders() {
    const lenders = [];
    for (const id of LENDER_IDS) {
      lenders.push({
        lenderId: id,
        label: LENDER_LABELS[id],
        vault: (await this.reader.getLenderVault(id)).toString(),
      });
    }
    return { lenders, ltvBps: (await this.reader.getLtvBps()).toString() };
  }

  @Sse('events')
  stream(): Observable<{ data: string }> {
    return this.events.asObservable().pipe(map((event) => ({ data: JSON.stringify(event) })));
  }
}
