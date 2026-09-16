import { Inject, Injectable } from '@nestjs/common';
import {
  InvoiceNotFoundError,
  NullifierAlreadyUsedError,
  AmountExceedsLtvError,
  isWithinLtv,
  type FinancingResult,
  type Hex,
  type LenderId,
} from '@once/domain';
import { computeNullifier } from '@once/crypto';
import {
  CHAIN_READER, CHAIN_WRITER,
  type ChainReader, type ChainWriter,
} from './ports/chain.gateway.js';
import { PRIVATE_STATE_REPO, type PrivateStateRepository } from './ports/private-state.repository.js';
import { ISSUER_STRATEGY, type IssuerVerificationStrategy } from './ports/issuer-verification.strategy.js';

export interface RequestFinancingCommand {
  readonly supplierId: string;
  readonly invoiceId: Hex;
  readonly lenderId: LenderId;
  readonly amount: bigint;
  readonly recipient: Hex;
}

/**
 * 진행 단계 보고. 유스케이스는 "어디를 지나고 있는지"만 알리고,
 * 그걸 SSE로 보낼지 로그로 남길지는 모른다 (SRP).
 */
export type StageReporter = (stage: 'witness' | 'proving' | 'submitting') => void;

/**
 * SRP — 흐름만 조율한다. 계산도 제출도 직접 하지 않는다 (SPEC §5, §8.2).
 */
@Injectable()
export class RequestFinancingUseCase {
  constructor(
    @Inject(PRIVATE_STATE_REPO) private readonly privateState: PrivateStateRepository,
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
    @Inject(CHAIN_WRITER) private readonly writer: ChainWriter,
    @Inject(ISSUER_STRATEGY) private readonly issuer: IssuerVerificationStrategy,
  ) {}

  async execute(
    cmd: RequestFinancingCommand,
    reportStage: StageReporter = () => undefined,
  ): Promise<FinancingResult> {
    const invoice = await this.privateState.findInvoice(cmd.supplierId, cmd.invoiceId);
    if (!invoice) throw new InvoiceNotFoundError();

    const ltvBps = await this.reader.getLtvBps();
    if (!isWithinLtv(cmd.amount, invoice.faceAmount, ltvBps)) {
      throw new AmountExceedsLtvError();
    }

    // ─────────────────────────────────────────────────────────────
    // 사전 검사 — 사용자 경험용일 뿐, 보안 경계가 아니다.
    //
    // 이 조회와 아래 submitFinancing 사이에는 틈이 있다. 그 틈에서 다른
    // 금융사가 같은 채권으로 대출을 확정할 수 있다. 실제 방어는 컨트랙트
    // finance 회로 안의 실행 시점 검사다 (INV-3).
    //
    // 이 검사가 보안 경계라고 착각해서 회로 쪽 검사를 "중복"이라며 지우면
    // A5와 A6가 둘 다 뚫린다. 지우지 말 것.
    // ─────────────────────────────────────────────────────────────
    const issuerId = await this.reader.getIssuerId();
    const nullifier = computeNullifier(issuerId, invoice.invoiceId);
    if (await this.reader.isNullifierUsed(nullifier)) {
      throw new NullifierAlreadyUsedError();
    }

    reportStage('witness');
    await this.issuer.buildWitness(invoice);
    const ownerSecret = await this.privateState.getOwnerSecret(cmd.supplierId);

    const result = await this.writer.submitFinancing({
      lender: cmd.lenderId,
      amount: cmd.amount,
      recipient: cmd.recipient,
      onStage: reportStage,
      witness: {
        invoiceId: invoice.invoiceId,
        faceAmount: invoice.faceAmount,
        salt: invoice.salt,
        ownerSecret,
      },
    });

    return {
      nullifier: result.nullifier,
      commitment: result.commitment,
      lender: cmd.lenderId,
      amount: cmd.amount.toString(),
      txHash: result.txHash,
      block: result.block,
    };
  }
}
