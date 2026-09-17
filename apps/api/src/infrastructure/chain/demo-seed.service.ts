import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { deriveOwnerPublicKey } from '@once/crypto';
import type { InvoiceDetail } from '@once/domain';
import { IssueInvoiceUseCase } from '../../application/issue-invoice.usecase.js';
import {
  PRIVATE_STATE_REPO, type PrivateStateRepository,
} from '../../application/ports/private-state.repository.js';
import { InMemoryPrivateStateRepository } from '../persistence/in-memory-private-state.repository.js';
import { InMemoryApplicationLog } from '../persistence/in-memory-application-log.js';
import { InMemoryIdentityRegistry } from '../persistence/in-memory-identity.registry.js';
import { SUPPLIER_ID, loadEnv } from '../../config/demo.config.js';

/**
 * 데모 최소 구성을 부팅 시 준비한다:
 * 발급 기관 1곳, 납품업체 1곳, 금융사 2곳, 채권 3건 (CONTEXT §8).
 */
const SEED_INVOICES: readonly { faceAmount: bigint; detail: InvoiceDetail }[] = [
  {
    faceAmount: 100_000_000n,
    detail: {
      counterparty: '대한전자 주식회사',
      dueDate: '2026-10-31',
      approvalNumber: '20260917-41002983-11223344',
      memo: '9월 정밀부품 납품분',
    },
  },
  {
    faceAmount: 50_000_000n,
    detail: {
      counterparty: '한빛중공업 주식회사',
      dueDate: '2026-11-15',
      approvalNumber: '20260917-41002983-55667788',
      memo: '설비 유지보수 계약분',
    },
  },
  {
    faceAmount: 250_000_000n,
    detail: {
      counterparty: '서일화학 주식회사',
      dueDate: '2026-12-20',
      approvalNumber: '20260917-41002983-99001122',
      memo: '4분기 원자재 공급분',
    },
  },
];

@Injectable()
export class DemoSeedService implements OnModuleInit {
  constructor(
    @Inject(IssueInvoiceUseCase) private readonly issueInvoice: IssueInvoiceUseCase,
    @Inject(PRIVATE_STATE_REPO) private readonly privateState: PrivateStateRepository,
    @Inject(InMemoryApplicationLog) private readonly applications: InMemoryApplicationLog,
    @Inject(InMemoryIdentityRegistry) private readonly identities: InMemoryIdentityRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reseed();
  }

  /** 채권 원문 저장소와 온체인 리프를 초기 상태로 되돌린다. */
  async reseed(): Promise<void> {
    const env = loadEnv();

    // 원장을 되돌렸는데 신청 큐가 남아 있으면 금융사 화면이 없는 대출을 가리킨다
    this.applications.clear();
    // 역할 등록부도 되돌린다. 남겨 두면 없는 대출을 가진 금융사가 생긴다.
    this.identities.clear();

    // 포트 인터페이스에 데모 전용 메서드를 넣지 않는다. 구체 타입으로 좁힌다.
    if (this.privateState instanceof InMemoryPrivateStateRepository) {
      this.privateState.clear();
      this.privateState.setOwnerSecret(SUPPLIER_ID, env.SUPPLIER_SECRET_KEY as `0x${string}`);
    }


    for (const seed of SEED_INVOICES) {
      await this.issueInvoice.execute({
        supplierId: SUPPLIER_ID,
        faceAmount: seed.faceAmount,
        detail: seed.detail,
      });
    }
  }

  /** 데모 리셋용. 소유자 공개키를 다시 계산해 확인만 한다. */
  ownerPublicKey(secret: `0x${string}`): string {
    return deriveOwnerPublicKey(secret);
  }
}
