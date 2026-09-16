import { Inject, Injectable } from '@nestjs/common';
import { computeNullifier, type Hex } from '@once/crypto';
import { maxLoanAmount, type SupplierInvoiceView } from '@once/domain';
import { CHAIN_READER, type ChainReader } from './ports/chain.gateway.js';
import { PRIVATE_STATE_REPO, type PrivateStateRepository } from './ports/private-state.repository.js';

/**
 * 납품업체 본인의 채권 목록.
 * 반환하는 것은 액면금액·한도·사용 여부뿐이다. 구매기업명·지급일·승인번호는
 * 내보내지 않는다 (DESIGN §5.2).
 */
@Injectable()
export class ListInvoicesUseCase {
  constructor(
    @Inject(PRIVATE_STATE_REPO) private readonly privateState: PrivateStateRepository,
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
  ) {}

  async execute(supplierId: string): Promise<readonly SupplierInvoiceView[]> {
    const invoices = await this.privateState.listInvoices(supplierId);
    const issuerId = await this.reader.getIssuerId();
    const ltvBps = await this.reader.getLtvBps();

    const views: SupplierInvoiceView[] = [];
    for (const invoice of invoices) {
      const nullifier = computeNullifier(issuerId as Hex, invoice.invoiceId);
      views.push({
        invoiceId: invoice.invoiceId,
        faceAmount: invoice.faceAmount.toString(),
        maxLoanAmount: maxLoanAmount(invoice.faceAmount, ltvBps).toString(),
        used: await this.reader.isNullifierUsed(nullifier),
      });
    }
    return views;
  }
}
