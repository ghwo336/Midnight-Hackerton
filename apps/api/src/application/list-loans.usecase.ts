import { Inject, Injectable } from '@nestjs/common';
import { CHAIN_READER, type ChainReader, type PublicLoanView } from './ports/chain.gateway.js';

/**
 * 공개 원장 조회. ISP에 따라 ChainReader만 주입받는다. 지급 메서드에
 * 접근할 수 없다 (SPEC §5).
 *
 * 반환 타입에 채권 원문 필드가 없다. 추가하지 않는다 (CONTEXT §4.1).
 */
@Injectable()
export class ListLoansUseCase {
  constructor(@Inject(CHAIN_READER) private readonly reader: ChainReader) {}

  async execute(): Promise<readonly PublicLoanView[]> {
    return this.reader.listLoans();
  }
}
