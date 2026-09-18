import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  IndexerClient, decodeLedger, digestToHex, traceLoans,
  bytesToHex as indexerBytesToHex,
  type ContractAction, type Ledger, type LoanOrigin,
} from '@once/indexer';
import { ServerCannotSignError, type Hex, type LenderId } from '@once/domain';
import type {
  ChainReader, ChainStatus, ChainWriter, FinancingTx, PublicLoanView, RepaymentTx, TxResult,
} from '../../application/ports/chain.gateway.js';
import { LENDER_KEYS, lenderIdFromKey } from '../../config/demo.config.js';
import { NETWORK_CONFIG, type NetworkConfig } from './network.config.js';

/**
 * 실제 Midnight 체인을 읽는 게이트웨이.
 *
 * **읽기 전용이다.** 쓰기는 사용자 지갑이 브라우저에서 한다. 서버가
 * 대신 서명하면 "유저가 자기 지갑으로 직접 서명한다" 가 거짓이 되므로,
 * 여기서는 쓰기 메서드가 명시적으로 거부한다. 조용히 시뮬레이터로
 * 넘어가지 않는다 — 그러면 화면이 체인에 없는 일을 있었던 것처럼 보인다.
 *
 * LSP: LocalCircuitChainGateway 와 같은 ChainReader 계약을 지킨다.
 * 공유 계약 테스트가 두 구현에 같은 스위트를 돌린다 (SPEC §5).
 */
@Injectable()
export class MidnightChainGateway implements ChainReader, ChainWriter, OnModuleInit {
  private readonly client: IndexerClient;
  /** 최신 원장 뷰. 짧게 캐시한다. 매 요청마다 인덱서를 때리면 화면이 느려진다. */
  private cached: { ledger: Ledger; block: number; at: number } | null = null;
  /** nullifier → 그 대출을 만든 tx. 온체인 상태에 없어서 액션 이력으로 복원한다. */
  private origins = new Map<Hex, LoanOrigin>();
  private originsScannedTo = 0;

  constructor(@Inject(NETWORK_CONFIG) private readonly config: NetworkConfig | null) {
    /*
     * local-circuit 모드에서도 이 클래스는 주입된다. 그때 config 는 null 이고
     * 아무 메서드도 불리지 않는다. 클라이언트만 만들어 두고 사용 시점에 막는다.
     */
    this.client = new IndexerClient({
      httpUrl: config?.indexerHttp ?? '',
      wsUrl: config?.indexerWs ?? '',
      ...(config?.webSocket ? { webSocket: config.webSocket } : {}),
    });
  }

  private get net(): NetworkConfig {
    if (!this.config) {
      throw new Error('preprod 설정 없이 MidnightChainGateway 를 썼다. CHAIN_MODE 를 확인할 것');
    }
    return this.config;
  }

  async onModuleInit(): Promise<void> {
    if (!this.config) return;
    // 기동 시 한 번 데워 둔다. 첫 화면 요청이 인덱서 왕복을 기다리지 않게.
    await this.refresh().catch(() => undefined);
    await this.rebuildOrigins().catch(() => undefined);
  }

  // ── 상태 읽기 ──────────────────────────────────────────────

  private async refresh(): Promise<Ledger> {
    const fresh = this.cached !== null && Date.now() - this.cached.at < this.net.cacheMs;
    if (fresh && this.cached) return this.cached.ledger;

    const action = await this.client.latestAction(this.net.contractAddress);
    if (!action) {
      throw new Error(`컨트랙트 ${this.net.contractAddress} 의 액션을 인덱서에서 찾지 못했다`);
    }
    const view = decodeLedger(action.state);
    this.cached = { ledger: view, block: action.block, at: Date.now() };
    return view;
  }

  /**
   * 액션 이력을 다시 걸어 대출 → tx 대응을 복원한다.
   *
   * 새 대출이 생겼을 때만 부른다. 매번 하면 구독을 매번 여는 셈이라 느리다.
   */
  private async rebuildOrigins(): Promise<void> {
    const actions: readonly ContractAction[] = await this.client.actionsSince(
      this.net.contractAddress,
      this.net.deployBlock,
    );
    this.origins = traceLoans(actions);
    this.originsScannedTo = actions.at(-1)?.block ?? this.net.deployBlock;
  }

  async getIssuerId(): Promise<Hex> {
    return indexerBytesToHex((await this.refresh()).issuerId);
  }

  async getIssuerPk(): Promise<Hex> {
    return indexerBytesToHex((await this.refresh()).issuerPk);
  }

  async getIssuerRoot(): Promise<Hex> {
    return digestToHex((await this.refresh()).invoiceTree.root());
  }

  async getInvoiceCount(): Promise<number> {
    return Number((await this.refresh()).invoiceTree.firstFree());
  }

  async getLtvBps(): Promise<bigint> {
    return (await this.refresh()).ltvBps;
  }

  async hasInvoiceLeaf(leaf: Hex): Promise<boolean> {
    const view = await this.refresh();
    return view.invoiceTree.findPathForLeaf(hexToBytes(leaf)) !== undefined;
  }

  async isNullifierUsed(nullifier: Hex): Promise<boolean> {
    const view = await this.refresh();
    return view.usedNullifiers.member(hexToBytes(nullifier));
  }

  async getLenderVault(lender: LenderId): Promise<bigint> {
    const view = await this.refresh();
    const key = hexToBytes(LENDER_KEYS[lender]);
    return view.lenderVault.member(key) ? view.lenderVault.lookup(key) : 0n;
  }

  async getBorrowerBalance(address: Hex): Promise<bigint> {
    const view = await this.refresh();
    const key = hexToBytes(address);
    return view.borrowerBalance.member(key) ? view.borrowerBalance.lookup(key) : 0n;
  }

  /** 다음 읽기가 인덱서를 다시 때리게 한다. */
  async invalidate(): Promise<void> {
    this.cached = null;
  }

  async getBlockHeight(): Promise<number> {
    return (await this.client.tip()).height;
  }

  async getStatus(): Promise<ChainStatus> {
    const view = await this.refresh();
    return {
      network: this.net.name,
      // 실제 체인이다. tx 해시와 블록 번호가 진짜다.
      simulated: false,
      blockHeight: this.cached?.block ?? 0,
      contractAddress: this.net.contractAddress,
      connected: true,
      ltvBps: view.ltvBps.toString(),
    };
  }

  async listLoans(): Promise<readonly PublicLoanView[]> {
    const view = await this.refresh();

    // 아직 추적 못 한 대출이 있으면 이력을 다시 건다.
    const known = [...view.loans].every(([key]) => this.origins.has(indexerBytesToHex(key)));
    if (!known) await this.rebuildOrigins().catch(() => undefined);

    const out: PublicLoanView[] = [];
    for (const [key, record] of view.loans) {
      const lender = lenderIdFromKey(indexerBytesToHex(record.lender));
      if (!lender) continue;
      const nullifier = indexerBytesToHex(key);
      const origin = this.origins.get(nullifier);
      out.push({
        nullifier,
        lender,
        amount: record.amount.toString(),
        commitment: indexerBytesToHex(record.commitment),
        borrower: indexerBytesToHex(record.borrower),
        repaid: record.repaid,
        repaidBlock: origin?.repaidBlock ?? null,
        // 해시를 지어내지 않는다. 아직 못 찾았으면 없다고 말한다.
        block: origin?.block ?? null,
        txHash: origin?.txHash ?? null,
        settledAt: origin?.settledAt ?? null,
      });
    }
    return out;
  }

  // ── 쓰기: 서버는 서명하지 않는다 ───────────────────────────

  /**
   * 서버에는 서명키가 없다. 체인이 거부한 게 아니라 서버가 못 하는 것이다.
   * 두 경우를 같은 오류로 뭉치면 화면이 "체인이 막았다" 고 잘못 말한다.
   */
  private refuseWrite(): never {
    throw new ServerCannotSignError();
  }

  /*
   * 세 메서드 모두 async 다. 동기로 던지면 `.catch()` 를 단 호출부가
   * 잡지 못하고 호출 스택을 타고 올라간다 — Promise 를 돌려준다고 선언한
   * 인터페이스가 그렇게 행동하면 안 된다.
   */
  async submitFinancing(_tx: FinancingTx): Promise<TxResult> {
    void _tx;
    this.refuseWrite();
  }

  async submitRepayment(_tx: RepaymentTx): Promise<TxResult> {
    void _tx;
    this.refuseWrite();
  }

  async registerInvoiceLeaf(_leaf: Hex): Promise<void> {
    void _leaf;
    this.refuseWrite();
  }
}

function hexToBytes(hex: Hex): Uint8Array {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
