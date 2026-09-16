import { Inject, Injectable } from '@nestjs/common';
import { OnceContractSimulator } from '@once/chain';
import {
  ChainSubmitFailedError,
  InsufficientLenderFundingError,
  IssuerAttestationFailedError,
  LenderNotRegisteredError,
  NullifierAlreadyUsedError,
  AmountExceedsLtvError,
  OwnershipVerifyFailedError,
  type Hex,
  type LenderId,
} from '@once/domain';
import type {
  ChainReader, ChainWriter, FinancingTx, PublicLoanView, TxResult,
} from '../../application/ports/chain.gateway.js';
import { LENDER_KEYS, lenderIdFromKey } from '../../config/demo.config.js';

/**
 * 컴파일된 회로를 로컬에서 실행하는 체인 게이트웨이.
 *
 * LSP — 이 구현과 나중에 붙일 MidnightChainGateway는 같은 계약을 지킨다.
 * 특히 중복 nullifier에 대해 **둘 다 NullifierAlreadyUsedError를 던져야**
 * 한다. 목이 실제와 다른 오류를 던지면 테스트가 거짓말을 한다 (SPEC §5).
 * 공유 계약 테스트가 이를 강제한다.
 */
@Injectable()
export class LocalCircuitChainGateway implements ChainReader, ChainWriter {
  constructor(@Inject(OnceContractSimulator) private readonly sim: OnceContractSimulator) {}

  async getIssuerId(): Promise<Hex> {
    return this.sim.snapshot().issuerId;
  }

  async getLtvBps(): Promise<bigint> {
    return this.sim.snapshot().ltvBps;
  }

  async isNullifierUsed(nullifier: Hex): Promise<boolean> {
    return this.sim.isNullifierUsed(nullifier);
  }

  async getBlockHeight(): Promise<number> {
    return this.sim.currentBlock;
  }

  async getLenderVault(lender: LenderId): Promise<bigint> {
    return this.sim.snapshot().lenderVault.get(LENDER_KEYS[lender]) ?? 0n;
  }

  /** 공개 원장 조회. 채권 원문 필드를 담지 않는다. */
  async listLoans(): Promise<readonly PublicLoanView[]> {
    const snap = this.sim.snapshot();
    const out: PublicLoanView[] = [];
    for (const loan of snap.loans) {
      const lender = lenderIdFromKey(loan.lender);
      if (!lender) continue;
      out.push({
        nullifier: loan.nullifier,
        lender,
        amount: loan.amount.toString(),
        commitment: loan.commitment,
        block: this.sim.currentBlock,
        txHash: `0x${loan.nullifier.slice(2, 18)}${'0'.repeat(48)}` as Hex,
      });
    }
    return out;
  }

  async registerInvoiceLeaf(leaf: Hex): Promise<void> {
    await this.sim.registerInvoice(leaf);
  }

  async submitFinancing(tx: FinancingTx): Promise<TxResult> {
    try {
      return await this.sim.finance(
        {
          lender: tx.lender,
          amount: tx.amount,
          recipient: tx.recipient,
          witness: tx.witness,
        },
        LENDER_KEYS[tx.lender],
      );
    } catch (error: unknown) {
      throw translateCircuitFailure(error);
    }
  }
}

/**
 * 회로 assert 실패를 도메인 오류로 옮긴다.
 *
 * 원본 메시지를 그대로 흘리지 않는다. 회로 메시지에는 비밀값이 없지만,
 * 여기서 문자열을 통과시키기 시작하면 나중에 누군가 원문을 섞는다.
 */
export function translateCircuitFailure(error: unknown): Error {
  const raw = error instanceof Error ? error.message : '';

  if (raw.includes('nullifier already used')) return new NullifierAlreadyUsedError();
  if (raw.includes('lender not registered')) return new LenderNotRegisteredError();
  if (raw.includes('amount exceeds LTV')) return new AmountExceedsLtvError();
  if (raw.includes('insufficient lender funding')) return new InsufficientLenderFundingError();
  if (raw.includes('lender has no funding')) return new InsufficientLenderFundingError();
  if (raw.includes('invoice leaf mismatch')) return new OwnershipVerifyFailedError();
  if (raw.includes('invoice not attested by issuer')) return new IssuerAttestationFailedError();

  return new ChainSubmitFailedError();
}
