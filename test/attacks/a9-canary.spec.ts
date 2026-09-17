import { describe, expect, it } from 'vitest';
import { deriveIssuerPublicKey } from '@once/crypto';
import { OnceContractSimulator } from '@once/chain';
import { PUBLIC_LOAN_FIELDS, SUPPLIER_INVOICE_FIELDS, type Hex } from '@once/domain';

import { LocalCircuitChainGateway } from '../../apps/api/src/infrastructure/chain/local-circuit.gateway.js';
import { fixedSource } from '../../apps/api/src/infrastructure/chain/simulator.source.js';
import { MerkleIssuerStrategy } from '../../apps/api/src/infrastructure/chain/merkle-issuer.strategy.js';
import { InMemoryPrivateStateRepository } from '../../apps/api/src/infrastructure/persistence/in-memory-private-state.repository.js';
import { IssueInvoiceUseCase } from '../../apps/api/src/application/issue-invoice.usecase.js';
import { ListInvoicesUseCase } from '../../apps/api/src/application/list-invoices.usecase.js';
import { ListLoansUseCase } from '../../apps/api/src/application/list-loans.usecase.js';
import { RequestFinancingUseCase } from '../../apps/api/src/application/request-financing.usecase.js';
import { OnceEventsService, type OnceEvent } from '../../apps/api/src/interface/events/once-events.service.js';
import { maskSecrets } from '../../apps/api/src/common/logging/mask.js';
import { LENDER_FUNDING, LENDER_KEYS } from '../../apps/api/src/config/demo.config.js';

/**
 * A9: 채권 원문에 카나리아를 삽입하고 공개 경로를 전수 검색한다.
 * 기대: 어디에도 나타나지 않음.
 *
 * 주의: 문자열 미검출은 암호학적 비공개성의 증명이 아니다.
 * docs/TEST_REPORT.md에 공개 필드 목록과 disclose() 호출 지점의 수동 검토
 * 결과를 함께 기록한다 (SPEC §10.2).
 */
const CANARY = 'CANARY_ONCE_7F3A';
const SUPPLIER = 'supplier-1';
const ISSUER_ID = `0x${'11'.repeat(32)}` as Hex;
const ISSUER_SECRET = `0x${'5e'.repeat(32)}` as Hex;
const OWNER_SECRET = `0x${'7c'.repeat(32)}` as Hex;
const RECIPIENT = `0x${'cc'.repeat(32)}` as Hex;

async function buildStack() {
  const sim = await OnceContractSimulator.create({
    issuerId: ISSUER_ID,
    issuerSecret: ISSUER_SECRET,
    issuerPk: deriveIssuerPublicKey(ISSUER_SECRET),
    ltvBps: 8000n,
  });
  for (const key of Object.values(LENDER_KEYS)) {
    await sim.registerLender(key);
    await sim.fundLender(key, LENDER_FUNDING);
  }

  const gateway = new LocalCircuitChainGateway(fixedSource(sim));
  const repo = new InMemoryPrivateStateRepository();
  repo.setOwnerSecret(SUPPLIER, OWNER_SECRET);

  const events = new OnceEventsService();
  const captured: OnceEvent[] = [];
  events.asObservable().subscribe((event) => captured.push(event));

  return {
    sim,
    gateway,
    repo,
    events,
    captured,
    issueInvoice: new IssueInvoiceUseCase(repo, gateway),
    listInvoices: new ListInvoicesUseCase(repo, gateway),
    listLoans: new ListLoansUseCase(gateway),
    requestFinancing: new RequestFinancingUseCase(repo, gateway, gateway, new MerkleIssuerStrategy()),
  };
}

describe('A9: 카나리아 전수 검색', () => {
  it('채권 원문이 공개 경로 어디에도 나타나지 않는다', async () => {
    const stack = await buildStack();

    // 채권 원문 전 필드에 카나리아를 심는다
    const { invoiceId } = await stack.issueInvoice.execute({
      supplierId: SUPPLIER,
      faceAmount: 100_000_000n,
      detail: {
        counterparty: `${CANARY}_구매기업`,
        dueDate: `${CANARY}_2026-10-31`,
        approvalNumber: `${CANARY}_20260917`,
        memo: `${CANARY}_메모`,
      },
    });

    const settled = await stack.requestFinancing.execute({
      supplierId: SUPPLIER,
      invoiceId,
      lenderId: 'lender-a',
      amount: 80_000_000n,
      recipient: RECIPIENT,
    });
    stack.events.publish({
      type: 'financing.settled',
      nullifier: settled.nullifier,
      lender: settled.lender,
      amount: settled.amount,
      txHash: settled.txHash,
      block: settled.block,
    });

    // ── 공개 경로 전수 검색 ──
    const surfaces: Record<string, unknown> = {
      '공개 원장 API': await stack.listLoans.execute(),
      '납품업체 채권 목록 API': await stack.listInvoices.execute(SUPPLIER),
      'SSE 이벤트': stack.captured,
      '온체인 원장 스냅샷': stack.sim.snapshot(),
      '마스킹된 로그 출력': maskSecrets({
        body: await stack.repo.findInvoice(SUPPLIER, invoiceId),
      }),
    };

    for (const [name, surface] of Object.entries(surfaces)) {
      const serialised = JSON.stringify(surface, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(serialised, `${name}에서 카나리아가 발견됨`).not.toContain(CANARY);
    }
  });

  it('공개 원장 행에 허용된 필드만 존재한다', async () => {
    const stack = await buildStack();
    const { invoiceId } = await stack.issueInvoice.execute({
      supplierId: SUPPLIER,
      faceAmount: 100_000_000n,
      detail: {
        counterparty: `${CANARY}_x`, dueDate: `${CANARY}_y`,
        approvalNumber: `${CANARY}_z`, memo: CANARY,
      },
    });
    await stack.requestFinancing.execute({
      supplierId: SUPPLIER, invoiceId, lenderId: 'lender-a',
      amount: 80_000_000n, recipient: RECIPIENT,
    });

    const loans = await stack.listLoans.execute();
    expect(loans).toHaveLength(1);
    // 화이트리스트 밖 필드가 새로 생기면 여기서 잡힌다
    expect(Object.keys(loans[0] ?? {}).sort()).toEqual([...PUBLIC_LOAN_FIELDS].sort());
  });

  it('납품업체 목록에도 상세 정보가 실리지 않는다', async () => {
    const stack = await buildStack();
    await stack.issueInvoice.execute({
      supplierId: SUPPLIER,
      faceAmount: 100_000_000n,
      detail: {
        counterparty: `${CANARY}_구매기업`, dueDate: `${CANARY}_2026`,
        approvalNumber: `${CANARY}_승인`, memo: CANARY,
      },
    });
    const views = await stack.listInvoices.execute(SUPPLIER);
    expect(Object.keys(views[0] ?? {}).sort()).toEqual([...SUPPLIER_INVOICE_FIELDS].sort());
  });

  it('마스킹 인터셉터가 비밀 키를 가린다', () => {
    const masked = maskSecrets({
      salt: `0x${'d9'.repeat(32)}`,
      ownerSecret: `0x${'7c'.repeat(32)}`,
      faceAmount: 100_000_000n,
      detail: { counterparty: CANARY },
      lenderId: 'lender-a',
    }) as Record<string, unknown>;

    expect(masked['salt']).toBe('[redacted]');
    expect(masked['ownerSecret']).toBe('[redacted]');
    expect(masked['faceAmount']).toBe('[redacted]');
    expect(masked['detail']).toBe('[redacted]');
    expect(masked['lenderId']).toBe('lender-a'); // 공개 값은 남는다
  });

  it('도메인 오류 메시지에 비밀값이 없다', async () => {
    const stack = await buildStack();
    const { invoiceId } = await stack.issueInvoice.execute({
      supplierId: SUPPLIER,
      faceAmount: 100_000_000n,
      detail: {
        counterparty: `${CANARY}_구매기업`, dueDate: CANARY,
        approvalNumber: CANARY, memo: CANARY,
      },
    });
    await stack.requestFinancing.execute({
      supplierId: SUPPLIER, invoiceId, lenderId: 'lender-a',
      amount: 80_000_000n, recipient: RECIPIENT,
    });

    await expect(
      stack.requestFinancing.execute({
        supplierId: SUPPLIER, invoiceId, lenderId: 'lender-b',
        amount: 80_000_000n, recipient: RECIPIENT,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      const message = error instanceof Error ? `${error.message}${error.stack ?? ''}` : '';
      return !message.includes(CANARY);
    });
  });
});
