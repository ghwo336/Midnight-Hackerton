import { Injectable } from '@nestjs/common';
import { computeInvoiceLeaf, deriveOwnerPublicKey } from '@once/crypto';
import type { PrivateInvoice } from '@once/domain';
import type {
  IssuerVerificationStrategy, IssuerWitness,
} from '../../application/ports/issuer-verification.strategy.js';

/**
 * 스파이크 S3 결과에 따른 구현.
 *
 * Merkle 경로 자체는 회로의 witness가 원장에서 직접 유도한다
 * (`ledger.invoiceTree.findPathForLeaf`). 따라서 여기서는 리프만 계산하고
 * 경로를 TS에서 만들지 않는다. TS 트리와 회로 트리가 어긋날 여지를
 * 애초에 없앤다.
 */
@Injectable()
export class MerkleIssuerStrategy implements IssuerVerificationStrategy {
  readonly kind = 'merkle' as const;

  async buildWitness(invoice: PrivateInvoice): Promise<IssuerWitness> {
    return {
      leaf: computeInvoiceLeaf({
        invoiceId: invoice.invoiceId,
        faceAmount: invoice.faceAmount,
        ownerPk: invoice.ownerPk,
      }),
    };
  }
}

export { deriveOwnerPublicKey };
