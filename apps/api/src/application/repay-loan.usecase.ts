import { Inject, Injectable } from '@nestjs/common';
import { LoanNotFoundError, type Hex } from '@once/domain';
import {
  CHAIN_READER, CHAIN_WRITER, type ChainReader, type ChainWriter,
} from './ports/chain.gateway.js';

export interface RepayLoanCommand {
  readonly nullifier: Hex;
  readonly borrower: Hex;
}

/**
 * 대출 상환.
 *
 * 금액을 명령에서 받지 않는다. 원장의 대출 기록에서 읽는다. 화면이 보낸
 * 숫자를 그대로 쓰면 덜 갚고 끝내거나 더 갚는 경로가 생긴다. 이자는
 * 다루지 않으므로 갚을 금액은 언제나 원금 하나뿐이다.
 *
 * 상환해도 담보는 풀리지 않는다. 회로가 usedNullifiers 를 건드리지 않고,
 * A10 이 그걸 검증한다.
 */
@Injectable()
export class RepayLoanUseCase {
  constructor(
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
    @Inject(CHAIN_WRITER) private readonly writer: ChainWriter,
  ) {}

  async execute(cmd: RepayLoanCommand) {
    const loans = await this.reader.listLoans();
    const loan = loans.find((item) => item.nullifier === cmd.nullifier);
    if (!loan) throw new LoanNotFoundError();

    const result = await this.writer.submitRepayment({
      nullifier: cmd.nullifier,
      amount: BigInt(loan.amount),
    });

    return {
      nullifier: result.nullifier,
      amount: loan.amount,
      lender: loan.lender,
      txHash: result.txHash,
      block: result.block,
    };
  }
}
