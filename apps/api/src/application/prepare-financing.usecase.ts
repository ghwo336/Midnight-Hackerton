import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AmountExceedsLtvError,
  DomainError,
  InvoiceNotFoundError,
  NullifierAlreadyUsedError,
  isWithinLtv,
  reviewChecklist,
  selectDisclosure,
  type DisclosureField,
  type DomainErrorCode,
  type Hex,
  type LenderId,
  type RiskProfile,
} from '@once/domain';
import { computeNullifier } from '@once/crypto';
import { CHAIN_READER, type ChainReader } from './ports/chain.gateway.js';
import { PRIVATE_STATE_REPO, type PrivateStateRepository } from './ports/private-state.repository.js';
import { APPLICATION_LOG_WRITER, type ApplicationLogWriter } from './ports/application-log.js';
import { LENDER_KEYS } from '../config/demo.config.js';

export interface PrepareFinancingCommand {
  readonly supplierId: string;
  readonly invoiceId: Hex;
  readonly lenderId: LenderId;
  readonly amount: bigint;
  readonly recipient: Hex;
  readonly disclose?: readonly DisclosureField[];
}

/**
 * 브라우저가 회로를 돌리는 데 필요한 것 전부. 서버는 이 뒤로 관여하지 않는다.
 */
export interface FinancingPlan {
  readonly applicationId: string;
  readonly receivedAt: string;
  readonly lenderKey: Hex;
  readonly recipient: Hex;
  readonly amount: string;
  readonly nullifier: Hex;
  /** 납품업체 본인의 채권 원문. 본인 브라우저로만 나간다. */
  readonly witness: {
    readonly invoiceId: Hex;
    readonly faceAmount: string;
    readonly salt: Hex;
    readonly ownerSecret: Hex;
  };
  /** 이 금융사에만 전달될 위험 정보. 고른 항목만 키가 있다. */
  readonly disclosed: Partial<RiskProfile>;
}

/**
 * 실제 체인에서는 **서버가 서명하지 않는다.**
 *
 * 개인키는 사용자 지갑에만 있다. 서버가 할 수 있는 일은 신청 전에 알 수 있는
 * 것을 미리 확인하고, 브라우저가 회로에 넣을 재료를 건네주는 것까지다.
 * 서명·증명·제출은 브라우저가 한다 (confirm 으로 결과만 돌아온다).
 *
 * 여기의 검사는 **보안 경계가 아니다.** 사용자가 헛수고하지 않게 미리
 * 걸러줄 뿐이고, 진짜 방어는 finance 회로 안의 실행 시점 검사다 (INV-3).
 * 이 사전 검사를 건너뛰어도 체인은 같은 판정을 내린다.
 */
@Injectable()
export class PrepareFinancingUseCase {
  constructor(
    @Inject(PRIVATE_STATE_REPO) private readonly privateState: PrivateStateRepository,
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
    @Inject(APPLICATION_LOG_WRITER) private readonly applications: ApplicationLogWriter,
  ) {}

  async execute(cmd: PrepareFinancingCommand): Promise<FinancingPlan> {
    const receivedAt = new Date().toISOString();
    const startedAt = Date.now();
    let disclosed: Partial<RiskProfile> = {};
    let nullifier: Hex | null = null;

    try {
      const invoice = await this.privateState.findInvoice(cmd.supplierId, cmd.invoiceId);
      if (!invoice) throw new InvoiceNotFoundError();

      disclosed = selectDisclosure(invoice.risk, cmd.disclose);

      const ltvBps = await this.reader.getLtvBps();
      if (!isWithinLtv(cmd.amount, invoice.faceAmount, ltvBps)) {
        throw new AmountExceedsLtvError();
      }

      const issuerId = await this.reader.getIssuerId();
      nullifier = computeNullifier(issuerId, invoice.invoiceId);
      if (await this.reader.isNullifierUsed(nullifier)) {
        throw new NullifierAlreadyUsedError();
      }

      const ownerSecret = await this.privateState.getOwnerSecret(cmd.supplierId);
      const lenderKey = LENDER_KEYS[cmd.lenderId];

      return {
        applicationId: randomUUID(),
        receivedAt,
        lenderKey,
        recipient: cmd.recipient,
        amount: cmd.amount.toString(),
        nullifier,
        witness: {
          invoiceId: invoice.invoiceId,
          faceAmount: invoice.faceAmount.toString(),
          salt: invoice.salt,
          ownerSecret,
        },
        disclosed,
      };
    } catch (error: unknown) {
      /*
       * 회로까지 못 간 거부다. 금융사 화면이 "회로가 검증했다"고 말하면
       * 안 되므로 pre-check 로 남긴다.
       */
      const reason = error instanceof DomainError ? (error.code as DomainErrorCode) : null;
      await this.applications.record({
        id: randomUUID(),
        lender: cmd.lenderId,
        amount: cmd.amount.toString(),
        nullifier,
        receivedAt,
        outcome: 'rejected',
        checks: reviewChecklist(reason, 'pre-check'),
        reason,
        block: null,
        txHash: null,
        elapsedMs: Date.now() - startedAt,
        disclosed,
      });
      throw error;
    }
  }
}
