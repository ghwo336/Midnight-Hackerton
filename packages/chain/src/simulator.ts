import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits, type Ledger } from '@once/contract';
import { bytesToHex, hexToBytes, type Hex } from '@once/domain';
import { witnesses } from '@once/witness';
import {
  emptyPrivateState,
  issuerPrivateState,
  withActiveInvoice,
  type OncePrivateState,
} from '@once/witness';
import type { FinancingRequest, LedgerSnapshot, OnChainLoan, SubmitResult } from './types.js';

export interface SimulatorConfig {
  readonly issuerId: Hex;
  readonly issuerSecret: Hex;
  readonly issuerPk: Hex;
  readonly ltvBps: bigint;
}

type ChargedLedgerState = Parameters<typeof ledger>[0];

/** MerkleTreeDigest는 필드 원소 하나다. 화면에는 32바이트 16진수로 보인다. */
function digestToHex(digest: { field: bigint }): Hex {
  return `0x${digest.field.toString(16).padStart(64, '0')}` as Hex;
}

/**
 * 컴파일된 `once.compact` 회로를 로컬에서 실행하는 시뮬레이터.
 *
 * 목 구현이 아니라 **실제 회로 코드**를 돌린다. 따라서 LTV 초과, 소유권 위조,
 * 미등록 금융사, 중복 nullifier는 전부 회로의 assert가 거부한다.
 *
 * 한계 (docs/SPIKE.md에 기록): 로컬 실행은 증명 트랜스크립트를 실제로
 * 재생하지 않는다. 회로 로직은 항상 **현재 원장 상태**에 대해 실행되므로
 * A6(지연 제출)의 실행 시점 재검사는 정확히 모델링되지만, 노드가 수행하는
 * 트랜스크립트 검증 자체는 G4에서 확인한다.
 */
export class OnceContractSimulator {
  private readonly contract: Contract<OncePrivateState>;
  private readonly address: string;
  private readonly coinPublicKey: string;
  private state: ChargedLedgerState;
  private blockHeight = 1_000;
  private txCounter = 0;
  /** 제출 직렬화. 실제 체인이 블록 안에서 트랜잭션을 순서대로 적용하는 것을 모델링한다. */
  private queue: Promise<unknown> = Promise.resolve();
  /** nullifier → 확정 영수증. 패널과 원장이 같은 tx를 보여야 한다. */
  private readonly receipts = new Map<Hex, { txHash: Hex; block: number; settledAt: string }>();

  private constructor(
    contract: Contract<OncePrivateState>,
    address: string,
    coinPublicKey: string,
    state: ChargedLedgerState,
    readonly config: SimulatorConfig,
  ) {
    this.contract = contract;
    this.address = address;
    this.coinPublicKey = coinPublicKey;
    this.state = state;
  }

  static async create(config: SimulatorConfig): Promise<OnceContractSimulator> {
    const contract = new Contract<OncePrivateState>(witnesses);
    const coinPublicKey = '0'.repeat(64);
    const result = contract.initialState(
      createConstructorContext(emptyPrivateState(), coinPublicKey),
      hexToBytes(config.issuerId),
      hexToBytes(config.issuerPk),
      config.ltvBps,
    );
    return new OnceContractSimulator(
      contract,
      sampleContractAddress(),
      coinPublicKey,
      result.currentContractState as unknown as ChargedLedgerState,
      config,
    );
  }

  private context(privateState: OncePrivateState): CircuitContext<OncePrivateState> {
    return createCircuitContext(
      this.address,
      this.coinPublicKey,
      this.state as never,
      privateState,
    );
  }

  private advance(next: CircuitContext<OncePrivateState>): void {
    this.state = next.currentQueryContext.state as unknown as ChargedLedgerState;
    this.blockHeight += 1;
  }

  private nextTxHash(): Hex {
    this.txCounter += 1;
    return `0x${this.txCounter.toString(16).padStart(64, '0')}` as Hex;
  }

  /**
   * 동시에 들어온 호출을 순서대로 실행한다.
   * 두 트랜잭션이 같은 nullifier를 들고 거의 동시에 도착해도, 먼저 적용된
   * 쪽만 성공하고 나머지는 실행 시점 검사에서 거부된다 (A5).
   */
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  get ledgerView(): Ledger {
    return ledger(this.state);
  }

  // ── 발급 기관 권한 회로 ────────────────────────────────────

  async registerLender(lender: Hex, issuerSecret: Hex = this.config.issuerSecret): Promise<void> {
    const result = this.contract.impureCircuits.registerLender(
      this.context(issuerPrivateState(issuerSecret)),
      hexToBytes(lender),
    );
    this.advance(result.context);
  }

  async registerInvoice(leaf: Hex, issuerSecret: Hex = this.config.issuerSecret): Promise<void> {
    const result = this.contract.impureCircuits.registerInvoice(
      this.context(issuerPrivateState(issuerSecret)),
      hexToBytes(leaf),
    );
    this.advance(result.context);
  }

  async fundLender(lender: Hex, amount: bigint, issuerSecret: Hex = this.config.issuerSecret): Promise<void> {
    const result = this.contract.impureCircuits.fundLender(
      this.context(issuerPrivateState(issuerSecret)),
      hexToBytes(lender),
      amount,
    );
    this.advance(result.context);
  }

  // ── 핵심: 중복 확인값 등록 + 자금 지급 (INV-3) ──────────────

  /**
   * 회로를 **현재 원장 상태**에 대해 실행한다.
   * 증명을 언제 만들었는지와 무관하게, 중복 검사는 이 시점에 일어난다.
   */
  async finance(request: FinancingRequest, lenderKey: Hex): Promise<SubmitResult> {
    return this.enqueue(() => this.executeFinance(request, lenderKey));
  }

  private async executeFinance(request: FinancingRequest, lenderKey: Hex): Promise<SubmitResult> {
    const privateState = withActiveInvoice(emptyPrivateState(), request.witness);
    const result = this.contract.impureCircuits.finance(
      this.context(privateState),
      hexToBytes(lenderKey),
      request.amount,
      { bytes: hexToBytes(request.recipient) },
    );
    this.advance(result.context);

    const view = ledger(this.state);
    const nullifier = bytesToHex(
      pureCircuits.nullifierOf(
        hexToBytes(this.config.issuerId),
        hexToBytes(request.witness.invoiceId),
      ),
    );
    const record = view.loans.lookup(hexToBytes(nullifier));
    const receipt = {
      txHash: this.nextTxHash(),
      block: this.blockHeight,
      settledAt: new Date().toISOString(),
    };
    this.receipts.set(nullifier, receipt);
    return {
      nullifier,
      commitment: bytesToHex(record.commitment),
      txHash: receipt.txHash,
      block: receipt.block,
    };
  }

  // ── 읽기 ───────────────────────────────────────────────────

  isNullifierUsed(nullifier: Hex): boolean {
    return this.ledgerView.usedNullifiers.member(hexToBytes(nullifier));
  }

  snapshot(): LedgerSnapshot {
    const view = this.ledgerView;
    const loans: OnChainLoan[] = [];
    for (const [nullifier, record] of view.loans) {
      const key = bytesToHex(nullifier);
      const receipt = this.receipts.get(key);
      loans.push({
        nullifier: key,
        lender: bytesToHex(record.lender),
        amount: record.amount,
        commitment: bytesToHex(record.commitment),
        txHash: receipt?.txHash ?? null,
        block: receipt?.block ?? this.blockHeight,
        settledAt: receipt?.settledAt ?? null,
      });
    }
    const vault = new Map<Hex, bigint>();
    for (const [lender, balance] of view.lenderVault) {
      vault.set(bytesToHex(lender), balance);
    }
    const lenders: Hex[] = [];
    for (const lender of view.registeredLenders) lenders.push(bytesToHex(lender));

    return {
      contractAddress: this.address,
      issuerId: bytesToHex(view.issuerId),
      ltvBps: view.ltvBps,
      nullifierCount: Number(view.usedNullifiers.size()),
      loans,
      lenderVault: vault,
      registeredLenders: lenders,
      invoiceTreeSize: Number(view.invoiceTree.firstFree()),
      issuerRoot: digestToHex(view.invoiceTree.root()),
    };
  }

  get contractAddress(): string {
    return this.address;
  }

  get currentBlock(): number {
    return this.blockHeight;
  }
}
