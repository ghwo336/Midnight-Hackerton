import { Inject, Injectable } from '@nestjs/common';
import { webcrypto } from 'node:crypto';
import {
  bytesToHex, type Hex, type InvoiceDetail, type PrivateInvoice, type RiskProfile,
} from '@once/domain';
import { computeInvoiceLeaf, deriveOwnerPublicKey, generateSalt } from '@once/crypto';
import { CHAIN_WRITER, type ChainWriter } from './ports/chain.gateway.js';
import { PRIVATE_STATE_REPO, type PrivateStateRepository } from './ports/private-state.repository.js';

export interface IssueInvoiceCommand {
  readonly supplierId: string;
  readonly faceAmount: bigint;
  readonly detail: InvoiceDetail;
  readonly risk: RiskProfile;
  /**
   * 식별자를 지정한다. 실제 체인에 이미 등록된 채권의 비공개 상태를
   * 되살릴 때 쓴다. 생략하면 새로 만든다.
   */
  readonly invoiceId?: Hex;
  /** 온체인 리프 등록을 건너뛴다. 체인에 이미 있는 경우. */
  readonly skipChainWrite?: boolean;
}

/**
 * 발급 기관이 채권을 발급한다.
 *
 * 원장에 올라가는 것은 리프 해시뿐이다. 채권 원문은 납품업체 저장소에만
 * 들어간다 (CONTEXT §4.2: 처음부터 원문이 원장에 닿지 않는 경로).
 */
@Injectable()
export class IssueInvoiceUseCase {
  constructor(
    @Inject(PRIVATE_STATE_REPO) private readonly privateState: PrivateStateRepository,
    @Inject(CHAIN_WRITER) private readonly writer: ChainWriter,
  ) {}

  async execute(cmd: IssueInvoiceCommand): Promise<{ invoiceId: Hex }> {
    const ownerSecret = await this.privateState.getOwnerSecret(cmd.supplierId);
    const ownerPk = deriveOwnerPublicKey(ownerSecret);

    // 실사용 시 국세청 승인번호에서 유도한다. 데모에서는 목업이지만
    // 구조는 "발급 기관이 부여하고 복사해도 바뀌지 않는 값"을 전제한다.
    const invoiceId = cmd.invoiceId ?? bytesToHex(webcrypto.getRandomValues(new Uint8Array(32)));
    const salt = generateSalt();

    const invoice: PrivateInvoice = {
      invoiceId,
      faceAmount: cmd.faceAmount,
      salt,
      ownerPk,
      leafIndex: 0,
      detail: cmd.detail,
      risk: cmd.risk,
    };

    await this.privateState.saveInvoice(cmd.supplierId, invoice);
    if (!cmd.skipChainWrite) {
      await this.writer.registerInvoiceLeaf(
        computeInvoiceLeaf({ invoiceId, faceAmount: cmd.faceAmount, ownerPk }),
      );
    }

    return { invoiceId };
  }
}
