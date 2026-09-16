import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { isLenderId } from '@once/domain';
import { CHAIN_READER, type ChainReader } from '../../application/ports/chain.gateway.js';
import { Inject } from '@nestjs/common';
import { LENDER_LABELS } from '../../config/demo.config.js';

/**
 * 금융사 화면용.
 *
 * 이 컨트롤러는 PrivateStateRepository를 주입받지 않는다. 금융사 세션이
 * 납품업체 채권 원문에 닿는 경로가 코드에 존재하지 않게 하기 위해서다
 * (SPEC §3.1).
 */
@Controller('lender')
export class LenderController {
  constructor(@Inject(CHAIN_READER) private readonly reader: ChainReader) {}

  @Get(':lenderId')
  async state(@Param('lenderId') lenderId: string) {
    if (!isLenderId(lenderId)) throw new NotFoundException({ code: 'LENDER_NOT_FOUND' });

    const loans = await this.reader.listLoans();
    return {
      lenderId,
      label: LENDER_LABELS[lenderId],
      vault: (await this.reader.getLenderVault(lenderId)).toString(),
      loans: loans.filter((loan) => loan.lender === lenderId),
    };
  }
}
