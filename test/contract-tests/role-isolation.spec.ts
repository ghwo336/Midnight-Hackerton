import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { deriveIssuerPublicKey, computeInvoiceLeaf, deriveOwnerPublicKey } from '@once/crypto';
import { OnceContractSimulator } from '@once/chain';
import {
  APPLICATION_FIELDS, LENDER_STATE_FIELDS, PUBLIC_LOAN_FIELDS, SECRET_FIELD_KEYS, type Hex,
} from '@once/domain';
import { LocalCircuitChainGateway } from '../../apps/api/src/infrastructure/chain/local-circuit.gateway.js';
import { fixedSource } from '../../apps/api/src/infrastructure/chain/simulator.source.js';
import { MerkleIssuerStrategy } from '../../apps/api/src/infrastructure/chain/merkle-issuer.strategy.js';
import { InMemoryPrivateStateRepository } from '../../apps/api/src/infrastructure/persistence/in-memory-private-state.repository.js';
import { InMemoryApplicationLog } from '../../apps/api/src/infrastructure/persistence/in-memory-application-log.js';
import { RequestFinancingUseCase } from '../../apps/api/src/application/request-financing.usecase.js';
import { LenderController } from '../../apps/api/src/interface/http/lender.controller.js';
import { LENDER_FUNDING, LENDER_KEYS } from '../../apps/api/src/config/demo.config.js';

/**
 * 역할 격리.
 *
 * 화면을 역할별로 나눠도, 금융사 엔드포인트가 채권 원문을 돌려줄 수 있으면
 * 나눈 의미가 없다. 여기서 검사하는 것은 두 가지다.
 *
 *   1. 코드 경로: 금융사 컨트롤러가 채권 원문 저장소에 닿지 않는다
 *   2. 응답 내용: 자기 것만 나가고, 다른 금융사 것은 나가지 않는다
 *
 * "화면에서 안 보인다"는 근거가 아니다. 응답에 담겨 있으면 개발자 도구에서
 * 보인다.
 */
const ISSUER_ID = `0x${'11'.repeat(32)}` as Hex;
const ISSUER_SECRET = `0x${'5e'.repeat(32)}` as Hex;
const OWNER_SECRET = `0x${'7c'.repeat(32)}` as Hex;
const RECIPIENT = `0x${'cc'.repeat(32)}` as Hex;
const CANARY = 'CANARY_ROLE_9B2C';
const SUPPLIER = 'supplier-1';

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
  const applications = new InMemoryApplicationLog();

  const financing = new RequestFinancingUseCase(
    repo, gateway, gateway, new MerkleIssuerStrategy(), applications,
  );
  const controller = new LenderController(gateway, applications);

  /** 카나리아를 심은 채권 하나를 발급한다. */
  const issue = async (faceAmount: bigint): Promise<Hex> => {
    const invoiceId = `0x${'a1'.repeat(32)}` as Hex;
    const ownerPk = deriveOwnerPublicKey(OWNER_SECRET);
    await repo.saveInvoice(SUPPLIER, {
      invoiceId,
      faceAmount,
      salt: `0x${'d9'.repeat(32)}` as Hex,
      ownerPk,
      leafIndex: 0,
      detail: {
        counterparty: `${CANARY}_구매기업`,
        dueDate: `${CANARY}_2026-10-31`,
        approvalNumber: `${CANARY}_20260917`,
        memo: `${CANARY}_메모`,
      },
    });
    await sim.registerInvoice(computeInvoiceLeaf({ invoiceId, faceAmount, ownerPk }));
    return invoiceId;
  };

  return { sim, gateway, repo, applications, financing, controller, issue };
}

describe('역할 격리: 금융사 경로', () => {
  it('금융사 컨트롤러가 채권 원문 저장소를 주입받지 않는다', async () => {
    const raw = await readFile(
      new URL('../../apps/api/src/interface/http/lender.controller.ts', import.meta.url),
      'utf8',
    );
    // 주석은 벗긴다. 이 파일의 주석이 바로 그 이름들을 설명하고 있어서,
    // 벗기지 않으면 테스트가 자기 설명문에 걸린다.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    // 원문에 닿는 유일한 통로다. 생기면 여기서 잡힌다.
    expect(source).not.toContain('private-state.repository');
    expect(source).not.toContain('PRIVATE_STATE_REPO');
    expect(source).not.toContain('PrivateStateRepository');
    expect(source).not.toContain('InvoiceDetail');
    // 회로에 넘기는 witness 타입도 금융사 쪽에 올 이유가 없다
    expect(source).not.toContain('@once/chain');
  });

  it('응답 최상위 필드가 화이트리스트와 정확히 같다', async () => {
    const stack = await buildStack();
    const state = await stack.controller.state('lender-a');
    expect(Object.keys(state).sort()).toEqual([...LENDER_STATE_FIELDS].sort());
  });

  it('신청 한 건의 필드가 화이트리스트와 정확히 같다', async () => {
    const stack = await buildStack();
    const invoiceId = await stack.issue(100_000_000n);
    await stack.financing.execute({
      supplierId: SUPPLIER, invoiceId, lenderId: 'lender-a',
      amount: 80_000_000n, recipient: RECIPIENT,
    });

    const state = await stack.controller.state('lender-a');
    expect(state.applications).toHaveLength(1);
    expect(Object.keys(state.applications[0] ?? {}).sort())
      .toEqual([...APPLICATION_FIELDS].sort());
    expect(Object.keys(state.loans[0] ?? {}).sort())
      .toEqual([...PUBLIC_LOAN_FIELDS].sort());
  });

  it('금융사 응답에 채권 원문이 없다', async () => {
    const stack = await buildStack();
    const invoiceId = await stack.issue(100_000_000n);
    await stack.financing.execute({
      supplierId: SUPPLIER, invoiceId, lenderId: 'lender-a',
      amount: 80_000_000n, recipient: RECIPIENT,
    });

    const serialised = JSON.stringify(await stack.controller.state('lender-a'));
    expect(serialised).not.toContain(CANARY);
    for (const key of SECRET_FIELD_KEYS) {
      expect(serialised, `금지 필드 ${key}`).not.toContain(`"${key}"`);
    }
  });

  it('한 금융사 응답에 다른 금융사의 활동이 들어가지 않는다', async () => {
    const stack = await buildStack();
    const invoiceId = await stack.issue(100_000_000n);

    // A는 확정, B는 같은 채권으로 거부된다
    await stack.financing.execute({
      supplierId: SUPPLIER, invoiceId, lenderId: 'lender-a',
      amount: 80_000_000n, recipient: RECIPIENT,
    });
    await expect(
      stack.financing.execute({
        supplierId: SUPPLIER, invoiceId, lenderId: 'lender-b',
        amount: 80_000_000n, recipient: RECIPIENT,
      }),
    ).rejects.toThrow();

    const a = await stack.controller.state('lender-a');
    const b = await stack.controller.state('lender-b');

    expect(a.applications).toHaveLength(1);
    expect(b.applications).toHaveLength(1);
    expect(a.applications.every((item) => item.lender === 'lender-a')).toBe(true);
    expect(b.applications.every((item) => item.lender === 'lender-b')).toBe(true);
    expect(a.loans.every((loan) => loan.lender === 'lender-a')).toBe(true);
    // B는 대출을 실행하지 않았으므로 자기 원장에 아무것도 없다
    expect(b.loans).toHaveLength(0);
  });

  it('거부된 신청도 회로가 보지 않은 검사를 통과로 표시하지 않는다', async () => {
    const stack = await buildStack();
    const invoiceId = await stack.issue(100_000_000n);
    await stack.financing.execute({
      supplierId: SUPPLIER, invoiceId, lenderId: 'lender-a',
      amount: 80_000_000n, recipient: RECIPIENT,
    });
    await expect(
      stack.financing.execute({
        supplierId: SUPPLIER, invoiceId, lenderId: 'lender-b',
        amount: 80_000_000n, recipient: RECIPIENT,
      }),
    ).rejects.toThrow();

    const b = await stack.controller.state('lender-b');
    const rejected = b.applications[0];
    expect(rejected?.outcome).toBe('rejected');
    expect(rejected?.reason).toBe('NULLIFIER_ALREADY_USED');
    /*
     * 순차 중복은 사전 검사가 먼저 거른다. 회로는 실행되지 않았다.
     * 그러므로 소유권·발급 기관 인증은 아무도 보지 않았고, 미평가여야 한다.
     * 여기가 초록으로 바뀌면 화면이 하지 않은 검증을 주장하는 것이다.
     */
    expect(rejected?.checks.ownership.state).toBe('skipped');
    expect(rejected?.checks.issuer.state).toBe('skipped');
    expect(rejected?.checks.unused).toEqual({ state: 'fail', by: 'pre-check' });
  });
});
