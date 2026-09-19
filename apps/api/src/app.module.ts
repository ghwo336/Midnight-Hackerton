import { Module } from '@nestjs/common';
import { OnceContractSimulator } from '@once/chain';

import { CHAIN_READER, CHAIN_WRITER } from './application/ports/chain.gateway.js';
import { PRIVATE_STATE_REPO } from './application/ports/private-state.repository.js';
import { ISSUER_STRATEGY } from './application/ports/issuer-verification.strategy.js';
import {
  APPLICATION_LOG_READER, APPLICATION_LOG_WRITER,
} from './application/ports/application-log.js';
import { IDENTITY_REGISTRY } from './application/ports/identity.registry.js';
import { INVOICE_REQUESTS } from './application/ports/invoice-requests.js';

import { IssueInvoiceUseCase } from './application/issue-invoice.usecase.js';
import { ListInvoicesUseCase } from './application/list-invoices.usecase.js';
import { ListLoansUseCase } from './application/list-loans.usecase.js';
import { RequestFinancingUseCase } from './application/request-financing.usecase.js';
import { RepayLoanUseCase } from './application/repay-loan.usecase.js';
import { PrepareFinancingUseCase } from './application/prepare-financing.usecase.js';
import { ConfirmFinancingUseCase } from './application/confirm-financing.usecase.js';
import { PrepareIssuanceUseCase } from './application/prepare-issuance.usecase.js';
import { ConfirmIssuanceUseCase } from './application/confirm-issuance.usecase.js';
import { PENDING_ISSUANCE } from './application/ports/pending-issuance.js';
import { InMemoryPendingIssuance } from './infrastructure/persistence/in-memory-pending-issuance.js';
import { RunAttackUseCase } from './application/run-attack.usecase.js';

import { LocalCircuitChainGateway } from './infrastructure/chain/local-circuit.gateway.js';
import { MidnightChainGateway } from './infrastructure/chain/midnight.gateway.js';
import {
  NETWORK_CONFIG, isPreprodMode, loadPreprodConfig,
} from './infrastructure/chain/network.config.js';
import { SimulatorHolder } from './infrastructure/chain/simulator.holder.js';
import { SIMULATOR_SOURCE } from './infrastructure/chain/simulator.source.js';
import { MerkleIssuerStrategy } from './infrastructure/chain/merkle-issuer.strategy.js';
import { DemoSeedService } from './infrastructure/chain/demo-seed.service.js';
import { InMemoryPrivateStateRepository } from './infrastructure/persistence/in-memory-private-state.repository.js';
import { InMemoryApplicationLog } from './infrastructure/persistence/in-memory-application-log.js';
import { InMemoryIdentityRegistry } from './infrastructure/persistence/in-memory-identity.registry.js';
import { InMemoryInvoiceRequests } from './infrastructure/persistence/in-memory-invoice-requests.js';

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

    /*
     * 체인 모드.
     *
     * preprod 면 인덱서로 실제 체인을 읽고, 아니면 프로세스 안의 회로를
     * 실행한다. 기본값은 local-circuit 이다 — 심사위원이 클론하고 아무
     * 설정 없이 돌릴 수 있어야 한다 (README §1).
     *
     * 두 모드가 섞이지 않는다. preprod 인데 설정이 모자라면 기본값으로
     * 때우지 않고 기동을 멈춘다. 빈 원장에 붙어 "대출 0건" 을 보여주는
     * 것이 틀린 정보가 조용히 맞아 보이는 경우다.
     */
    {
      provide: NETWORK_CONFIG,
      useFactory: async () => {
        if (!isPreprodMode()) return null;
        const { default: WebSocketImpl } = await import('ws');
        return { ...loadPreprodConfig(), webSocket: WebSocketImpl as never };
      },
    },
    MidnightChainGateway,
    InMemoryPrivateStateRepository,
    InMemoryApplicationLog,
    InMemoryIdentityRegistry,
    InMemoryInvoiceRequests,

    {
      provide: CHAIN_READER,
      inject: [LocalCircuitChainGateway, MidnightChainGateway],
      useFactory: (local: LocalCircuitChainGateway, chain: MidnightChainGateway) =>
        isPreprodMode() ? chain : local,
    },
    {
      provide: CHAIN_WRITER,
      inject: [LocalCircuitChainGateway, MidnightChainGateway],
      useFactory: (local: LocalCircuitChainGateway, chain: MidnightChainGateway) =>
        isPreprodMode() ? chain : local,
    },
    { provide: PRIVATE_STATE_REPO, useExisting: InMemoryPrivateStateRepository },
    { provide: APPLICATION_LOG_WRITER, useExisting: InMemoryApplicationLog },
    { provide: APPLICATION_LOG_READER, useExisting: InMemoryApplicationLog },
    { provide: IDENTITY_REGISTRY, useExisting: InMemoryIdentityRegistry },
    { provide: INVOICE_REQUESTS, useExisting: InMemoryInvoiceRequests },
    { provide: ISSUER_STRATEGY, useClass: MerkleIssuerStrategy },

    IssueInvoiceUseCase,
    ListInvoicesUseCase,
    ListLoansUseCase,
    RequestFinancingUseCase,
    RepayLoanUseCase,
    PrepareFinancingUseCase,
    ConfirmFinancingUseCase,
    PrepareIssuanceUseCase,
    ConfirmIssuanceUseCase,
    InMemoryPendingIssuance,
    { provide: PENDING_ISSUANCE, useExisting: InMemoryPendingIssuance },
    RunAttackUseCase,
    OnceEventsService,
    DemoSeedService,
  ],
})
export class AppModule {}
