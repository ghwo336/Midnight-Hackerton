import { Inject, Injectable } from '@nestjs/common';
import { ClaimNotOnChainError, InvoiceNotFoundError, type Hex, type PrivateInvoice } from '@once/domain';
import { CHAIN_READER, type ChainReader } from './ports/chain.gateway.js';
import { PRIVATE_STATE_REPO, type PrivateStateRepository } from './ports/private-state.repository.js';
import { PENDING_ISSUANCE, type PendingIssuanceStore } from './ports/pending-issuance.js';

export interface ConfirmIssuanceCommand {
  readonly issuanceId: string;
  readonly txHash: Hex | null;
  readonly block: number | null;
}

export interface IssuanceResult {
  readonly invoiceId: Hex;
  readonly requestId: string | null;
  readonly rootAfter: Hex;
  readonly invoiceCount: number;
  readonly txHash: Hex | null;
  readonly block: number | null;
}

/**
 * 브라우저가 리프를 올렸다는 보고를 받는다. **그대로 믿지 않는다.**
 *
 * 발급자 트리에 그 리프가 실제로 있는지 원장에서 확인한 뒤에만 비공개
 * 상태에 커밋한다. 확인 없이 적으면, 체인에 없는 채권이 납품업체 화면에
 * 담보로 뜬다. 그걸 신청하면 회로의 `checkRoot` 에서 거부되는데 화면은
 * 왜인지 설명하지 못한다 — 사용자에게는 제품이 고장난 것으로 보인다.
 */
@Injectable()
export class ConfirmIssuanceUseCase {
  constructor(
    @Inject(PRIVATE_STATE_REPO) private readonly privateState: PrivateStateRepository,
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
    @Inject(PENDING_ISSUANCE) private readonly pending: PendingIssuanceStore,
  ) {}

  async execute(cmd: ConfirmIssuanceCommand): Promise<IssuanceResult> {
    const entry = await this.pending.take(cmd.issuanceId);
    if (!entry) throw new InvoiceNotFoundError();

    if (!(await this.onChain(entry.leaf))) {
      /*
       * 꺼내면서 지웠는데 확인에 실패했다. 다시 넣어 둔다 — 인덱서가
       * 아직 블록을 노출하지 않았을 뿐이면 다시 확정할 수 있어야 한다.
       */
      await this.pending.put(entry);
      throw new ClaimNotOnChainError();
    }

    const invoice: PrivateInvoice = {
      invoiceId: entry.invoiceId,
      faceAmount: entry.faceAmount,
      salt: entry.salt,
      ownerPk: entry.ownerPk,
      leafIndex: 0,
      detail: entry.detail,
      risk: entry.risk,
    };
    await this.privateState.saveInvoice(entry.supplierId, invoice);

    return {
      invoiceId: entry.invoiceId,
      requestId: entry.requestId,
      rootAfter: await this.reader.getIssuerRoot(),
      invoiceCount: await this.reader.getInvoiceCount(),
      txHash: cmd.txHash,
      block: cmd.block,
    };
  }

  /**
   * 리프가 발급자 트리에 들어갔는가.
   *
   * 캐시를 버리고 본다. 브라우저 쪽에서는 이미 블록에 들어갔는데 서버
   * 캐시가 몇 초 낡았다는 이유로 "없다" 고 판정하면 안 된다. 인덱서가
   * 방금 블록을 아직 노출하지 않았을 수 있어 한 번 더 기다렸다 본다.
   */
  private async onChain(leaf: Hex): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await sleep(2000);
      await this.reader.invalidate();
      if (await this.reader.hasInvoiceLeaf(leaf)) return true;
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
