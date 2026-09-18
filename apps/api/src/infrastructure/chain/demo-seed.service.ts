import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { computeInvoiceLeaf, deriveOwnerPublicKey } from '@once/crypto';
import type { InvoiceDetail, RiskProfile } from '@once/domain';
import { IssueInvoiceUseCase } from '../../application/issue-invoice.usecase.js';
import {
  PRIVATE_STATE_REPO, type PrivateStateRepository,
} from '../../application/ports/private-state.repository.js';
import { InMemoryPrivateStateRepository } from '../persistence/in-memory-private-state.repository.js';
import { InMemoryApplicationLog } from '../persistence/in-memory-application-log.js';
import { InMemoryInvoiceRequests } from '../persistence/in-memory-invoice-requests.js';
import { DEMO_INVOICE_IDS, SUPPLIER_ID, loadEnv } from '../../config/demo.config.js';
import { isPreprodMode } from './network.config.js';
import { CHAIN_READER, type ChainReader } from '../../application/ports/chain.gateway.js';

/**
 * 데모 최소 구성을 부팅 시 준비한다:
 * 발급 기관 1곳, 납품업체 1곳, 금융사 2곳, 채권 3건 (CONTEXT §8).
 */
/**
 * 등급을 서로 다르게 준다.
 *
 * 세 건이 같은 등급이면 금융사 화면에 위험 정보가 있어도 판단할 것이 없고,
 * 선택적 공개가 왜 필요한지도 드러나지 않는다. 등급·구간·업종이 다르면
 * 같은 한도라도 받을지 말지가 갈린다.
 */
const SEED_INVOICES: readonly {
  faceAmount: bigint;
  detail: InvoiceDetail;
  risk: RiskProfile;
}[] = [
  {
    faceAmount: 100_000_000n,
    detail: {
      counterparty: '대한전자 주식회사',
      dueDate: '2026-10-31',
      approvalNumber: '20260917-41002983-11223344',
      memo: '9월 정밀부품 납품분',
    },
    risk: { creditGrade: 'AA', dueWindow: '30~60일', industry: '전자부품 제조' },
  },
  {
    faceAmount: 50_000_000n,
    detail: {
      counterparty: '한빛중공업 주식회사',
      dueDate: '2026-11-15',
      approvalNumber: '20260917-41002983-55667788',
      memo: '설비 유지보수 계약분',
    },
    risk: { creditGrade: 'BBB', dueWindow: '60~90일', industry: '산업기계' },
  },
  {
    faceAmount: 250_000_000n,
    detail: {
      counterparty: '서일화학 주식회사',
      dueDate: '2026-12-20',
      approvalNumber: '20260917-41002983-99001122',
      memo: '4분기 원자재 공급분',
    },
    risk: { creditGrade: 'B', dueWindow: '90일 이상', industry: '기초화학' },
  },
];

@Injectable()
export class DemoSeedService implements OnModuleInit {
  constructor(
    @Inject(IssueInvoiceUseCase) private readonly issueInvoice: IssueInvoiceUseCase,
    @Inject(PRIVATE_STATE_REPO) private readonly privateState: PrivateStateRepository,
    @Inject(InMemoryApplicationLog) private readonly applications: InMemoryApplicationLog,
    @Inject(InMemoryInvoiceRequests) private readonly requests: InMemoryInvoiceRequests,
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reseed();
  }

  /** 채권 원문 저장소와 온체인 리프를 초기 상태로 되돌린다. */
  async reseed(): Promise<void> {
    const env = loadEnv();

    // 원장을 되돌렸는데 신청 큐가 남아 있으면 금융사 화면이 없는 대출을 가리킨다
    this.applications.clear();
    this.requests.clear();
    /*
     * 역할 등록부는 지우지 않는다.
     *
     * 리셋은 시나리오를 처음으로 돌리는 것이지 접속한 사람을 로그아웃
     * 시키는 게 아니다. 지우면 화면을 보던 사람이 갑자기 '시작하기' 로
     * 튕기고 역할을 다시 가져가야 한다. 대출이 0건인 금융사는 정상이다.
     */

    // 포트 인터페이스에 데모 전용 메서드를 넣지 않는다. 구체 타입으로 좁힌다.
    if (this.privateState instanceof InMemoryPrivateStateRepository) {
      this.privateState.clear();
      this.privateState.setOwnerSecret(SUPPLIER_ID, env.SUPPLIER_SECRET_KEY as `0x${string}`);
    }


    /*
     * preprod 에서는 채권이 이미 체인에 등록돼 있다. 리프를 다시 쓰지 않고
     * 비공개 상태(원문·salt·소유자)만 되살린다.
     *
     * 식별자를 배포 때와 같은 고정값으로 맞춘다. 온체인 리프는
     * (invoiceId, faceAmount, ownerPk) 로 계산되므로 새로 만들면 회로의
     * 발급 기관 인증 검사에서 걸린다.
     */
    const onChain = isPreprodMode();
    for (const [index, seed] of SEED_INVOICES.entries()) {
      const fixed = DEMO_INVOICE_IDS[index];
      await this.issueInvoice.execute({
        supplierId: SUPPLIER_ID,
        faceAmount: seed.faceAmount,
        detail: seed.detail,
        risk: seed.risk,
        ...(onChain && fixed ? { invoiceId: fixed, skipChainWrite: true } : {}),
      });
    }

    if (onChain) await this.assertLeavesOnChain(env.SUPPLIER_SECRET_KEY as `0x${string}`);
  }

  /**
   * 되살린 비공개 상태가 **실제로 체인 위의 채권과 같은 것인지** 확인한다.
   *
   * 온체인 리프는 (invoiceId, faceAmount, ownerPk) 로 계산된다. 소유자
   * 비밀키가 배포 때와 다르면 리프가 달라지고, 그 신청은 회로의
   * `assert(path.leaf == leaf)` 에서 거부된다. 그 시점에는 "invoice leaf
   * mismatch" 라는 회로 메시지만 남아서 원인이 키 불일치라는 걸 알기
   * 어렵다. 기동할 때 잡고 무엇이 어긋났는지 말한다.
   */
  private async assertLeavesOnChain(supplierSecret: `0x${string}`): Promise<void> {
    const ownerPk = deriveOwnerPublicKey(supplierSecret);
    const missing: string[] = [];

    for (const [index, seed] of SEED_INVOICES.entries()) {
      const invoiceId = DEMO_INVOICE_IDS[index];
      if (!invoiceId) continue;
      const leaf = computeInvoiceLeaf({ invoiceId, faceAmount: seed.faceAmount, ownerPk });
      if (!(await this.reader.hasInvoiceLeaf(leaf))) missing.push(invoiceId);
    }

    if (missing.length > 0) {
      throw new Error(
        `배포된 컨트랙트에 이 채권들의 리프가 없다: ${missing.join(', ')}. ` +
          'SUPPLIER_SECRET_KEY 가 배포에 쓰인 키와 다를 때 이렇게 된다 ' +
          `(지금 키의 소유자 공개키: ${ownerPk}). ` +
          'apps/web/src/shared/wallet/bootstrap.ts 의 DEMO.supplierSecret 과 맞춘다.',
      );
    }
  }

  /** 데모 리셋용. 소유자 공개키를 다시 계산해 확인만 한다. */
  ownerPublicKey(secret: `0x${string}`): string {
    return deriveOwnerPublicKey(secret);
  }
}
