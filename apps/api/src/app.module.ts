import { Module } from '@nestjs/common';
import { OnceContractSimulator } from '@once/chain';
import { deriveIssuerPublicKey } from '@once/crypto';

import { CHAIN_READER, CHAIN_WRITER } from './application/ports/chain.gateway.js';
import { PRIVATE_STATE_REPO } from './application/ports/private-state.repository.js';
import { ISSUER_STRATEGY } from './application/ports/issuer-verification.strategy.js';

import { IssueInvoiceUseCase } from './application/issue-invoice.usecase.js';
import { ListInvoicesUseCase } from './application/list-invoices.usecase.js';
import { ListLoansUseCase } from './application/list-loans.usecase.js';
import { RequestFinancingUseCase } from './application/request-financing.usecase.js';

import { LocalCircuitChainGateway } from './infrastructure/chain/local-circuit.gateway.js';
import { MerkleIssuerStrategy } from './infrastructure/chain/merkle-issuer.strategy.js';
import { DemoSeedService } from './infrastructure/chain/demo-seed.service.js';
import { InMemoryPrivateStateRepository } from './infrastructure/persistence/in-memory-private-state.repository.js';

import { PublicController } from './interface/http/public.controller.js';
import { SupplierController } from './interface/http/supplier.controller.js';
import { LenderController } from './interface/http/lender.controller.js';
import { OnceEventsService } from './interface/events/once-events.service.js';

import { loadEnv } from './config/demo.config.js';

/**
 * DIP — 유스케이스는 인터페이스에만 의존하고, 구현은 여기서 바인딩한다
 * (SPEC §5).
 *
 * 체인 구현을 MidnightChainGateway로 갈아끼울 때 이 파일의 두 줄만 바뀐다.
 * 유스케이스 코드는 수정하지 않는다 (SPEC §11 G4의 통과 조건).
 */
@Module({
  controllers: [PublicController, SupplierController, LenderController],
  providers: [
    {
      provide: OnceContractSimulator,
      useFactory: async () => {
        const env = loadEnv();
        return OnceContractSimulator.create({
          issuerId: env.ISSUER_ID as `0x${string}`,
          issuerSecret: env.ISSUER_SECRET_KEY as `0x${string}`,
          issuerPk: deriveIssuerPublicKey(env.ISSUER_SECRET_KEY as `0x${string}`),
          ltvBps: env.LTV_BPS,
        });
      },
    },
    LocalCircuitChainGateway,
    InMemoryPrivateStateRepository,

    { provide: CHAIN_READER, useExisting: LocalCircuitChainGateway },
    { provide: CHAIN_WRITER, useExisting: LocalCircuitChainGateway },
    { provide: PRIVATE_STATE_REPO, useExisting: InMemoryPrivateStateRepository },
    { provide: ISSUER_STRATEGY, useClass: MerkleIssuerStrategy },

    IssueInvoiceUseCase,
    ListInvoicesUseCase,
    ListLoansUseCase,
    RequestFinancingUseCase,
    OnceEventsService,
    DemoSeedService,
  ],
})
export class AppModule {}
