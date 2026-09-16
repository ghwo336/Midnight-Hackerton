import { Controller, Get, Inject, Sse } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { ListLoansUseCase } from '../../application/list-loans.usecase.js';
import { OnceEventsService } from '../events/once-events.service.js';

/**
 * 공개 원장 — 읽기 전용.
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
  ) {}

  @Get('loans')
  async loans() {
    return { loans: await this.listLoans.execute() };
  }

  @Sse('events')
  stream(): Observable<{ data: string }> {
    return this.events.asObservable().pipe(map((event) => ({ data: JSON.stringify(event) })));
  }
}
