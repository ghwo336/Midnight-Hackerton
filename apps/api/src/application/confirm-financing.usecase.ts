import { Inject, Injectable } from '@nestjs/common';
import {
  ClaimNotOnChainError,
  reviewChecklist,
  type DomainErrorCode,
  type Hex,
  type LenderId,
  type RiskProfile,
} from '@once/domain';
import { CHAIN_READER, type ChainReader } from './ports/chain.gateway.js';
import { APPLICATION_LOG_WRITER, type ApplicationLogWriter } from './ports/application-log.js';

/** 브라우저가 체인에 무엇을 했다고 주장하는지. 그대로 믿지 않는다. */
export interface ConfirmFinancingCommand {
  readonly applicationId: string;
  readonly lenderId: LenderId;
  readonly amount: bigint;
  readonly nullifier: Hex;
  readonly receivedAt: string;
  readonly elapsedMs: number;
  readonly disclosed: Partial<RiskProfile>;
  readonly outcome: 'settled' | 'rejected';
  readonly txHash: Hex | null;
  readonly block: number | null;
  /** 거부일 때 회로가 낸 사유. 확정이면 무시한다. */
  readonly reason: DomainErrorCode | null;
}

/**
 * 브라우저가 낸 결과를 기록한다. **주장을 그대로 믿지 않는다.**
 *
 * 서명이 사용자 지갑으로 넘어가면 서버는 결과를 목격하지 못한다. 그렇다고
 * 클라이언트가 보낸 "확정됐다"를 그대로 적으면, 아무나 원장에 없는 대출을
 * 금융사 화면에 띄울 수 있다. 그래서 적기 전에 원장을 읽어 대조한다.
 *
 * 화면이 그리는 대출 자체는 언제나 원장에서 온다. 여기서 기록하는 것은
 * 온체인에 없는 정보뿐이다 — 어느 금융사가 무엇을 받아 봤고, 심사 항목
 * 중 무엇이 검증됐고, 몇 초 걸렸는지.
 */
@Injectable()
export class ConfirmFinancingUseCase {
  constructor(
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
    @Inject(APPLICATION_LOG_WRITER) private readonly applications: ApplicationLogWriter,
  ) {}

  async execute(cmd: ConfirmFinancingCommand): Promise<{ recorded: true }> {
    if (cmd.outcome === 'settled') {
      await this.verifySettled(cmd);
    } else {
      await this.verifyRejected(cmd);
    }

    await this.applications.record({
      id: cmd.applicationId,
      lender: cmd.lenderId,
      amount: cmd.amount.toString(),
      nullifier: cmd.nullifier,
      receivedAt: cmd.receivedAt,
      outcome: cmd.outcome,
      /*
       * 회로가 판정한 건이다. 여기까지 왔다는 것은 브라우저가 finance 를
       * 실제로 호출했고 체인이 응답했다는 뜻이다.
       */
      checks: reviewChecklist(cmd.outcome === 'settled' ? null : cmd.reason, 'circuit'),
      reason: cmd.outcome === 'settled' ? null : cmd.reason,
      block: cmd.block,
      txHash: cmd.txHash,
      elapsedMs: cmd.elapsedMs,
      disclosed: cmd.disclosed,
    });

    return { recorded: true };
  }

  /** 원장에 그 대출이 실제로 있고, 금융사와 금액이 주장과 같아야 한다. */
  private async verifySettled(cmd: ConfirmFinancingCommand): Promise<void> {
    const loan = await this.findLoan(cmd.nullifier, true);
    if (!loan) throw new ClaimNotOnChainError();
    if (loan.lender !== cmd.lenderId) throw new ClaimNotOnChainError();
    if (BigInt(loan.amount) !== cmd.amount) throw new ClaimNotOnChainError();
  }

  /**
   * 대출 한 건을 원장에서 찾는다.
   *
   * 캐시를 버리고 읽는다. 브라우저 쪽에서는 이미 블록에 들어갔는데 서버
   * 캐시가 몇 초 낡았다는 이유로 "체인에 없다" 고 판정하면 안 된다.
   * `awaitAppearance` 면 한 번 더 기다렸다 본다 — 인덱서가 방금 블록을
   * 아직 노출하지 않았을 수 있다.
   */
  private async findLoan(nullifier: Hex, awaitAppearance: boolean) {
    for (let attempt = 0; attempt < (awaitAppearance ? 3 : 1); attempt += 1) {
      if (attempt > 0) await sleep(2000);
      await this.reader.invalidate();
      const loans = await this.reader.listLoans();
      const hit = loans.find((item) => item.nullifier === nullifier);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * 거부는 원장에 흔적을 남기지 않는다. 확인할 수 있는 것은 하나뿐이다:
   * **지급이 일어나지 않았어야 한다.** 거부라면서 원장에 그 대출이
   * 있으면 거짓이다.
   */
  private async verifyRejected(cmd: ConfirmFinancingCommand): Promise<void> {
    // 없어야 정상이다. 기다리지 않는다.
    const loan = await this.findLoan(cmd.nullifier, false);
    if (loan && loan.lender === cmd.lenderId && BigInt(loan.amount) === cmd.amount) {
      throw new ClaimNotOnChainError();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
