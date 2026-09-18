import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DomainError,
  InvoiceNotFoundError,
  NullifierAlreadyUsedError,
  AmountExceedsLtvError,
  isWithinLtv,
  reviewChecklist,
  selectDisclosure,
  type CheckVerifier,
  type DisclosureField,
  type RiskProfile,
  type DomainErrorCode,
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
import {
  APPLICATION_LOG_WRITER, type ApplicationLogWriter,
} from './ports/application-log.js';

export interface RequestFinancingCommand {
  readonly supplierId: string;
  readonly invoiceId: Hex;
  readonly lenderId: LenderId;
  readonly amount: bigint;
  readonly recipient: Hex;
  /**
   * 이 금융사에 내줄 위험 정보 항목.
   *
   * 선택이다. 없으면 아무것도 내주지 않고 금융사는 검증 결과만 본다.
   * 빠뜨렸을 때 전부 나가는 쪽으로 열리면 안 된다.
   */
  readonly disclose?: readonly DisclosureField[];
}

/**
 * 진행 단계 보고. 유스케이스는 "어디를 지나고 있는지"만 알리고,
 * 그걸 SSE로 보낼지 로그로 남길지는 모른다 (SRP).
 */
export type StageReporter = (stage: 'witness' | 'proving' | 'submitting') => void;

/**
 * SRP: 흐름만 조율한다. 계산도 제출도 직접 하지 않는다 (SPEC §5, §8.2).
 */
@Injectable()
export class RequestFinancingUseCase {
  constructor(
    @Inject(PRIVATE_STATE_REPO) private readonly privateState: PrivateStateRepository,
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
    @Inject(CHAIN_WRITER) private readonly writer: ChainWriter,
    @Inject(ISSUER_STRATEGY) private readonly issuer: IssuerVerificationStrategy,
    @Inject(APPLICATION_LOG_WRITER) private readonly applications: ApplicationLogWriter,
  ) {}

  async execute(
    cmd: RequestFinancingCommand,
    reportStage: StageReporter = () => undefined,
  ): Promise<FinancingResult> {
    const receivedAt = new Date().toISOString();
    const startedAt = Date.now();
    const id = randomUUID();

    /*
     * 거부가 어디서 났는지 기록한다.
     *
     * 아래 사전 검사는 보안 경계가 아니다. 회로가 같은 것을 실행 시점에
     * 다시 본다. 그런데 사전 검사가 먼저 걸러 버리면 회로는 실행되지 않고,
     * 그 신청에 대해 "회로가 검증했다"고 말할 근거가 없다. 금융사 화면이
     * 두 경우를 같게 그리면 검증되지 않은 주장을 하게 된다.
     */
    let verifier: CheckVerifier = 'pre-check';
    let nullifier: Hex | null = null;
    /*
     * 거부돼도 금융사는 이미 받아 봤다. 기록에서 빼면 화면이 실제로
     * 오간 것과 달라진다.
     */
    let disclosed: Partial<RiskProfile> = {};

    try {
      const result = await this.run(cmd, reportStage, {
        setVerifier: (value) => { verifier = value; },
        setNullifier: (value) => { nullifier = value; },
        setDisclosed: (value) => { disclosed = value; },
      });
      await this.applications.record({
        id,
        lender: cmd.lenderId,
        amount: result.amount,
        nullifier: result.nullifier,
        receivedAt,
        outcome: 'settled',
        checks: reviewChecklist(null),
        reason: null,
        block: result.block,
        txHash: result.txHash,
        elapsedMs: Date.now() - startedAt,
        disclosed,
      });
      return result;
    } catch (error: unknown) {
      const reason = error instanceof DomainError ? (error.code as DomainErrorCode) : null;
      await this.applications.record({
        id,
        lender: cmd.lenderId,
        amount: cmd.amount.toString(),
        nullifier,
        receivedAt,
        outcome: 'rejected',
        checks: reviewChecklist(reason, verifier),
        reason,
        block: null,
        txHash: null,
        elapsedMs: Date.now() - startedAt,
        disclosed,
      });
      throw error;
    }
  }

  private async run(
    cmd: RequestFinancingCommand,
    reportStage: StageReporter,
    track: {
      setVerifier: (value: CheckVerifier) => void;
      setNullifier: (value: Hex) => void;
      setDisclosed: (value: Partial<RiskProfile>) => void;
    },
  ): Promise<FinancingResult> {
    const invoice = await this.privateState.findInvoice(cmd.supplierId, cmd.invoiceId);
    if (!invoice) throw new InvoiceNotFoundError();

    // 납품업체가 고른 항목만 추린다. 고르지 않은 항목은 키가 생기지 않는다.
    track.setDisclosed(selectDisclosure(invoice.risk, cmd.disclose));

    const ltvBps = await this.reader.getLtvBps();
    if (!isWithinLtv(cmd.amount, invoice.faceAmount, ltvBps)) {
      throw new AmountExceedsLtvError();
    }

    // ─────────────────────────────────────────────────────────────
    // 사전 검사: 사용자 경험용일 뿐, 보안 경계가 아니다.
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
    track.setNullifier(nullifier);
    if (await this.reader.isNullifierUsed(nullifier)) {
      throw new NullifierAlreadyUsedError();
    }

    reportStage('witness');
    await this.issuer.buildWitness(invoice);
    const ownerSecret = await this.privateState.getOwnerSecret(cmd.supplierId);

    // 여기서부터는 회로가 판정한다. 위 사전 검사와 구분해서 기록한다.
    track.setVerifier('circuit');
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
