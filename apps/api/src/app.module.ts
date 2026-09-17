import { Module } from '@nestjs/common';
import { OnceContractSimulator } from '@once/chain';

import { CHAIN_READER, CHAIN_WRITER } from './application/ports/chain.gateway.js';
import { PRIVATE_STATE_REPO } from './application/ports/private-state.repository.js';
import { ISSUER_STRATEGY } from './application/ports/issuer-verification.strategy.js';
import {
  APPLICATION_LOG_READER, APPLICATION_LOG_WRITER,
} from './application/ports/application-log.js';
import { IDENTITY_REGISTRY } from './application/ports/identity.registry.js';

import { IssueInvoiceUseCase } from './application/issue-invoice.usecase.js';
import { ListInvoicesUseCase } from './application/list-invoices.usecase.js';
import { ListLoansUseCase } from './application/list-loans.usecase.js';
import { RequestFinancingUseCase } from './application/request-financing.usecase.js';
import { RunAttackUseCase } from './application/run-attack.usecase.js';

import { LocalCircuitChainGateway } from './infrastructure/chain/local-circuit.gateway.js';
import { SimulatorHolder } from './infrastructure/chain/simulator.holder.js';
import { SIMULATOR_SOURCE } from './infrastructure/chain/simulator.source.js';
import { MerkleIssuerStrategy } from './infrastructure/chain/merkle-issuer.strategy.js';
import { DemoSeedService } from './infrastructure/chain/demo-seed.service.js';
import { InMemoryPrivateStateRepository } from './infrastructure/persistence/in-memory-private-state.repository.js';
import { InMemoryApplicationLog } from './infrastructure/persistence/in-memory-application-log.js';
import { InMemoryIdentityRegistry } from './infrastructure/persistence/in-memory-identity.registry.js';

import { PublicController } from './interface/http/public.controller.js';
import { SupplierController } from './interface/http/supplier.controller.js';
import { LenderController } from './interface/http/lender.controller.js';
import { IssuerController } from './interface/http/issuer.controller.js';
import { IdentityController } from './interface/http/identity.controller.js';
import { DemoController } from './interface/http/demo.controller.js';
import { OnceEventsService } from './interface/events/once-events.service.js';


/**
 * DIP: 유스케이스는 인터페이스에만 의존하고, 구현은 여기서 바인딩한다
 * (SPEC §5).
 *
 * 체인 구현을 MidnightChainGateway로 갈아끼울 때 이 파일의 두 줄만 바뀐다.
 * 유스케이스 코드는 수정하지 않는다 (SPEC §11 G4의 통과 조건).
 */
@Module({
  controllers: [
    PublicController,
    SupplierController,
    LenderController,
    IssuerController,
    IdentityController,
    DemoController,
  ],
  providers: [
    { provide: OnceContractSimulator, useFactory: () => SimulatorHolder.build() },
    SimulatorHolder,
    { provide: SIMULATOR_SOURCE, useExisting: SimulatorHolder },
    LocalCircuitChainGateway,
    InMemoryPrivateStateRepository,
    InMemoryApplicationLog,
    InMemoryIdentityRegistry,

    { provide: CHAIN_READER, useExisting: LocalCircuitChainGateway },
    { provide: CHAIN_WRITER, useExisting: LocalCircuitChainGateway },
    { provide: PRIVATE_STATE_REPO, useExisting: InMemoryPrivateStateRepository },
    { provide: APPLICATION_LOG_WRITER, useExisting: InMemoryApplicationLog },
    { provide: APPLICATION_LOG_READER, useExisting: InMemoryApplicationLog },
    { provide: IDENTITY_REGISTRY, useExisting: InMemoryIdentityRegistry },
    { provide: ISSUER_STRATEGY, useClass: MerkleIssuerStrategy },

    IssueInvoiceUseCase,
    ListInvoicesUseCase,
    ListLoansUseCase,
    RequestFinancingUseCase,
    RunAttackUseCase,
    OnceEventsService,
    DemoSeedService,
  ],
})
export class AppModule {}
