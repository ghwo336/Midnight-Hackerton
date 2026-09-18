import { Inject, Injectable } from '@nestjs/common';
import { OnceContractSimulator } from '@once/chain';
import { bytesToHex } from '@once/domain';
import { SIMULATOR_SOURCE, type SimulatorSource } from './simulator.source.js';
import {
  ChainSubmitFailedError,
  InsufficientLenderFundingError,
  IssuerAttestationFailedError,
  LenderNotRegisteredError,
  NullifierAlreadyUsedError,
  AmountExceedsLtvError,
  LoanAlreadyRepaidError,
  LoanNotFoundError,
  RepaymentBelowPrincipalError,
  type Hex,
  type LenderId,
} from '@once/domain';
import type {
  ChainReader, ChainStatus, ChainWriter, FinancingTx, PublicLoanView, RepaymentTx, TxResult,
} from '../../application/ports/chain.gateway.js';
import { LENDER_KEYS, lenderIdFromKey } from '../../config/demo.config.js';

/**
 * 컴파일된 회로를 로컬에서 실행하는 체인 게이트웨이.
 *
 * LSP: 이 구현과 나중에 붙일 MidnightChainGateway는 같은 계약을 지킨다.
 * 특히 중복 nullifier에 대해 **둘 다 NullifierAlreadyUsedError를 던져야**
 * 한다. 목이 실제와 다른 오류를 던지면 테스트가 거짓말을 한다 (SPEC §5).
 * 공유 계약 테스트가 이를 강제한다.
 */
@Injectable()
export class LocalCircuitChainGateway implements ChainReader, ChainWriter {
  constructor(@Inject(SIMULATOR_SOURCE) private readonly source: SimulatorSource) {}

  private get sim(): OnceContractSimulator {
    return this.source.current;
  }

  async getIssuerId(): Promise<Hex> {
    return this.sim.snapshot().issuerId;
  }

  async getIssuerPk(): Promise<Hex> {
    return bytesToHex(this.sim.ledgerView.issuerPk);
  }

  async getIssuerRoot(): Promise<Hex> {
    return this.sim.snapshot().issuerRoot;
  }

  async getInvoiceCount(): Promise<number> {
    return this.sim.snapshot().invoiceTreeSize;
  }

  async getLtvBps(): Promise<bigint> {
    return this.sim.snapshot().ltvBps;
  }

  async hasInvoiceLeaf(leaf: Hex): Promise<boolean> {
    return this.sim.ledgerView.invoiceTree.findPathForLeaf(hexToBytes32(leaf)) !== undefined;
  }

  async isNullifierUsed(nullifier: Hex): Promise<boolean> {
    return this.sim.isNullifierUsed(nullifier);
  }

  async getBlockHeight(): Promise<number> {
    return this.sim.currentBlock;
  }

  /**
   * 체인 이름을 'preprod'로 적지 않는다. 지금은 로컬 회로 실행이고,
   * 화면이 사실과 다른 것을 주장하면 안 된다 (README §5).
   */
  /** 원장이 프로세스 안에 있다. 캐시가 없으므로 할 일이 없다. */
  async invalidate(): Promise<void> {
    return undefined;
  }

  async getStatus(): Promise<ChainStatus> {
    const snap = this.sim.snapshot();
    return {
      network: 'local-circuit',
      // 회로 실행은 진짜지만 tx/블록은 시뮬레이터가 붙인 번호다
      simulated: true,
      blockHeight: this.sim.currentBlock,
      contractAddress: snap.contractAddress,
      connected: true,
      ltvBps: snap.ltvBps.toString(),
    };
  }

  async getBorrowerBalance(address: Hex): Promise<bigint> {
    return this.sim.snapshot().borrowerBalance.get(address) ?? 0n;
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
        block: loan.block,
        borrower: loan.borrower,
        repaid: loan.repaid,
        repaidBlock: loan.repaidBlock,
        txHash: loan.txHash ?? (`0x${'0'.repeat(64)}` as Hex),
        settledAt: loan.settledAt,
      });
    }
    return out;
  }

  async submitRepayment(tx: RepaymentTx): Promise<TxResult> {
    try {
      return await this.sim.repay({ nullifier: tx.nullifier, amount: tx.amount });
    } catch (error: unknown) {
      throw translateCircuitFailure(error);
    }
  }

  async registerInvoiceLeaf(leaf: Hex): Promise<void> {
    await this.sim.registerInvoice(leaf);
  }

  async submitFinancing(tx: FinancingTx): Promise<TxResult> {
    try {
      // 로컬 실행에서는 회로 실행이 곧 증명 생성이다.
      tx.onStage?.('proving');
      const result = await this.sim.finance(
        {
          lender: tx.lender,
          amount: tx.amount,
          recipient: tx.recipient,
          witness: tx.witness,
        },
        LENDER_KEYS[tx.lender],
      );
      // 여기서 트랜잭션이 존재한다. 제출과 확정이 로컬에서는 한 동작이라
      // 두 시각이 거의 같게 찍힌다. 그게 사실이므로 그대로 보여준다.
      tx.onStage?.('submitting');
      return result;
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
  // 리프 불일치는 "금액을 부풀렸다"와 "타인 채권이다"를 구분하지 않는다.
  // 회로가 아는 것은 "이 채권이 발급 기관 집합에 없다"뿐이다.
  // 구분해서 알려주면 공격자가 어느 필드를 틀렸는지 알아내는 오라클이 된다.
  if (raw.includes('invoice leaf mismatch')) return new IssuerAttestationFailedError();
  if (raw.includes('invoice not attested by issuer')) return new IssuerAttestationFailedError();

  // 상환 회로
  if (raw.includes('loan not found')) return new LoanNotFoundError();
  if (raw.includes('loan already repaid')) return new LoanAlreadyRepaidError();
  if (raw.includes('repayment below principal')) return new RepaymentBelowPrincipalError();
  if (raw.includes('insufficient borrower balance')) return new RepaymentBelowPrincipalError();

  return new ChainSubmitFailedError();
}

function hexToBytes32(hex: Hex): Uint8Array {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
