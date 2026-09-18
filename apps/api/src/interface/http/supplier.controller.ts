import { Body, Controller, Get, Inject, Post, UsePipes } from '@nestjs/common';
import type { DomainErrorCode } from '@once/domain';
import {
  CIRCUIT_ASSERT, ClaimNotOnChainError, DomainError, LoanNotFoundError,
  ServerCannotSignError, selectDisclosure,
} from '@once/domain';
import { ListInvoicesUseCase } from '../../application/list-invoices.usecase.js';
import { RepayLoanUseCase } from '../../application/repay-loan.usecase.js';
import { CHAIN_READER, type ChainReader } from '../../application/ports/chain.gateway.js';
import {
  INVOICE_REQUESTS, type InvoiceRequestQueue,
} from '../../application/ports/invoice-requests.js';
import { RequestFinancingUseCase } from '../../application/request-financing.usecase.js';
import { PrepareFinancingUseCase } from '../../application/prepare-financing.usecase.js';
import { ConfirmFinancingUseCase } from '../../application/confirm-financing.usecase.js';
import { isPreprodMode } from '../../infrastructure/chain/network.config.js';
import { OnceEventsService } from '../events/once-events.service.js';
import { SUPPLIER_ADDRESS, SUPPLIER_ID } from '../../config/demo.config.js';
import {
  ConfirmFinancingSchema, ConfirmRepaySchema,
  RepayLoanSchema, RequestFinancingSchema, RequestInvoiceSchema,
  type ConfirmFinancingDto, type ConfirmRepayDto,
  type RepayLoanDto, type RequestFinancingDto, type RequestInvoiceDto,
} from './dto/schemas.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

@Controller('supplier')
export class SupplierController {
  constructor(
    @Inject(ListInvoicesUseCase) private readonly listInvoices: ListInvoicesUseCase,
    @Inject(RequestFinancingUseCase) private readonly requestFinancing: RequestFinancingUseCase,
    @Inject(PrepareFinancingUseCase) private readonly prepareFinancing: PrepareFinancingUseCase,
    @Inject(ConfirmFinancingUseCase) private readonly confirmFinancing: ConfirmFinancingUseCase,
    @Inject(OnceEventsService) private readonly events: OnceEventsService,
    @Inject(RepayLoanUseCase) private readonly repayLoan: RepayLoanUseCase,
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
    @Inject(INVOICE_REQUESTS) private readonly requests: InvoiceRequestQueue,
  ) {}

  /**
   * 자금 상태.
   *
   * 가용 자금은 원장의 borrowerBalance 를 그대로 읽는다. 대출을 합산해
   * 만든 값이 아니다. 진행 중인 대출도 원장에서 파생한다.
   */
  @Get('funds')
  async funds() {
    const loans = await this.reader.listLoans();
    const mine = loans.filter((loan) => loan.borrower === SUPPLIER_ADDRESS);
    const outstanding = mine.filter((loan) => !loan.repaid);
    return {
      available: (await this.reader.getBorrowerBalance(SUPPLIER_ADDRESS)).toString(),
      positions: mine,
      outstandingCount: outstanding.length,
      outstandingTotal: outstanding
        .reduce((acc, loan) => acc + BigInt(loan.amount), 0n)
        .toString(),
    };
  }

  /**
   * 상환. 담보는 풀리지 않는다 (A10).
   *
   * 시뮬레이터 전용이다. 실제 체인에서는 개인키가 지갑에만 있으므로
   * 브라우저가 repay 회로를 부르고 아래 repay/confirm 으로 알려준다.
   */
  @Post('repay')
  @UsePipes(new ZodValidationPipe(RepayLoanSchema))
  async repay(@Body() dto: RepayLoanDto) {
    if (isPreprodMode()) throw new ServerCannotSignError();
    const result = await this.repayLoan.execute({
      nullifier: dto.nullifier as `0x${string}`,
      borrower: SUPPLIER_ADDRESS,
    });
    this.events.publish({ type: 'loan.repaid', nullifier: result.nullifier as `0x${string}` });
    return result;
  }

  /** 채권 등록 요청. 발급 기관이 승인해야 실제로 등록된다. */
  @Get('requests')
  async listRequests() {
    return { requests: await this.requests.listFor(SUPPLIER_ID) };
  }

  @Post('requests')
  @UsePipes(new ZodValidationPipe(RequestInvoiceSchema))
  async request(@Body() dto: RequestInvoiceDto) {
    const record = await this.requests.submit({
      supplierId: SUPPLIER_ID,
      faceAmount: dto.faceAmount,
      detail: {
        counterparty: dto.counterparty,
        dueDate: dto.dueDate,
        approvalNumber: dto.approvalNumber,
        memo: dto.memo,
      },
      risk: {
        creditGrade: dto.creditGrade,
        dueWindow: dto.dueWindow,
        industry: dto.industry,
      },
    });
    this.events.publish({ type: 'invoice.requested', requestId: record.id });
    return record;
  }

  /** 보유 채권. 액면·한도·사용 여부만 나간다. */
  @Get('invoices')
  async invoices() {
    return { invoices: await this.listInvoices.execute(SUPPLIER_ID) };
  }

  /**
   * 신청 준비. 실제 체인 경로의 첫 단계다.
   *
   * 서버가 미리 확인할 수 있는 것만 확인하고, 브라우저가 finance 회로에
   * 넣을 재료를 건넨다. 서명·증명·제출은 브라우저가 한다.
   *
   * 채권 원문은 **납품업체 본인 브라우저로만** 나간다. 금융사 경로에는
   * 이 응답으로 이어지는 길이 없다.
   */
  @Post('financing/prepare')
  @UsePipes(new ZodValidationPipe(RequestFinancingSchema))
  async prepare(@Body() dto: RequestFinancingDto) {
    const plan = await this.prepareFinancing.execute({
      supplierId: SUPPLIER_ID,
      invoiceId: dto.invoiceId as `0x${string}`,
      lenderId: dto.lenderId,
      amount: dto.amount,
      recipient: SUPPLIER_ADDRESS,
      disclose: dto.disclose,
    });

    // 금융사 화면이 "접수됨"을 곧바로 보게 한다. 결과는 아직 모른다.
    this.events.publish({
      type: 'financing.stage',
      lender: dto.lenderId,
      stage: 'witness',
      at: new Date().toISOString(),
      elapsedMs: 0,
    });

    return plan;
  }

  /**
   * 브라우저가 낸 결과 보고.
   *
   * 그대로 믿지 않는다. 기록하기 전에 원장을 읽어 대조한다.
   */
  @Post('financing/confirm')
  @UsePipes(new ZodValidationPipe(ConfirmFinancingSchema))
  async confirm(@Body() dto: ConfirmFinancingDto) {
    const reason = (dto.reason ?? null) as DomainErrorCode | null;

    await this.confirmFinancing.execute({
      applicationId: dto.applicationId,
      lenderId: dto.lenderId,
      amount: dto.amount,
      nullifier: dto.nullifier as `0x${string}`,
      receivedAt: dto.receivedAt,
      elapsedMs: dto.elapsedMs,
      disclosed: await this.disclosedFor(dto),
      outcome: dto.outcome,
      txHash: dto.txHash as `0x${string}` | null,
      block: dto.block,
      reason,
    });

    const at = new Date().toISOString();
    if (dto.outcome === 'settled') {
      this.events.publish({
        type: 'financing.stage',
        lender: dto.lenderId, stage: 'settled', at,
        elapsedMs: dto.elapsedMs,
        ...(dto.block === null ? {} : { block: dto.block }),
      });
      this.events.publish({
        type: 'financing.settled',
        nullifier: dto.nullifier as `0x${string}`,
        lender: dto.lenderId,
        amount: dto.amount.toString(),
        txHash: dto.txHash as `0x${string}`,
        block: dto.block ?? 0,
      });
    } else {
      this.events.publish({
        type: 'financing.stage',
        lender: dto.lenderId, stage: 'rejected', at,
        elapsedMs: dto.elapsedMs,
        ...(reason === null ? {} : { reason }),
        circuitAssert: reason ? CIRCUIT_ASSERT[reason] : null,
      });
      this.events.publish({
        type: 'financing.rejected',
        reason: reason ?? 'CHAIN_SUBMIT_FAILED',
        lender: dto.lenderId,
        circuitAssert: reason ? CIRCUIT_ASSERT[reason] : null,
      });
    }

    return { recorded: true };
  }

  /**
   * 상환 보고. 원장에서 repaid 를 확인하고 이벤트만 낸다.
   *
   * 화면이 그리는 값은 전부 원장에서 온다. 여기서 기록하는 상태는 없다.
   */
  @Post('repay/confirm')
  @UsePipes(new ZodValidationPipe(ConfirmRepaySchema))
  async confirmRepay(@Body() dto: ConfirmRepayDto) {
    const loans = await this.reader.listLoans();
    const loan = loans.find((item) => item.nullifier === dto.nullifier);
    if (!loan) throw new LoanNotFoundError();
    if (!loan.repaid) throw new ClaimNotOnChainError();

    this.events.publish({ type: 'loan.repaid', nullifier: dto.nullifier as `0x${string}` });
    return { nullifier: dto.nullifier, amount: loan.amount, lender: loan.lender, txHash: dto.txHash, block: dto.block };
  }

  /**
   * 금융사에 실제로 나간 위험 정보를 다시 추린다.
   *
   * 브라우저가 보낸 값을 그대로 적지 않는다. 고른 **항목 이름**만 받고
   * 값은 서버의 비공개 상태에서 읽는다. 그래야 신청자가 임의의 신용등급을
   * 금융사 화면에 꽂아 넣을 수 없다.
   *
   * 고르지 않은 항목은 빈 값이 아니라 아예 키가 없다 (selectDisclosure 는
   * 항목이 없으면 닫는 쪽으로 실패한다).
   */
  private async disclosedFor(dto: ConfirmFinancingDto) {
    if (dto.disclose.length === 0) return {};
    const invoices = await this.listInvoices.execute(SUPPLIER_ID);
    const source = invoices.find((item) => item.invoiceId === dto.invoiceId)?.risk;
    if (!source) return {};
    return selectDisclosure(source, dto.disclose);
  }

  /**
   * 서버가 서명하는 경로. **시뮬레이터 전용이다.**
   *
   * 실제 체인에서는 개인키가 지갑에만 있으므로 여기로 들어오면 안 된다.
   * 막지 않으면 사전 검사만 통과한 신청이 회로 검증을 받은 것처럼
   * 기록된다. 금융사 화면이 검증되지 않은 주장을 하게 된다.
   */
  @Post('financing')
  @UsePipes(new ZodValidationPipe(RequestFinancingSchema))
  async financing(@Body() dto: RequestFinancingDto) {
    if (isPreprodMode()) throw new ServerCannotSignError();
    const startedAt = Date.now();
    const stage = (name: 'witness' | 'proving' | 'submitting') => {
      this.events.publish({
        type: 'financing.stage',
        lender: dto.lenderId,
        stage: name,
        at: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
      });
    };

    try {
      const result = await this.requestFinancing.execute(
        {
          supplierId: SUPPLIER_ID,
          invoiceId: dto.invoiceId as `0x${string}`,
          lenderId: dto.lenderId,
          amount: dto.amount,
          recipient: SUPPLIER_ADDRESS,
          disclose: dto.disclose,
        },
        stage,
      );

      this.events.publish({
        type: 'financing.stage',
        lender: dto.lenderId,
        stage: 'settled',
        at: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        block: result.block,
      });

      this.events.publish({
        type: 'financing.settled',
        nullifier: result.nullifier,
        lender: result.lender,
        amount: result.amount,
        txHash: result.txHash,
        block: result.block,
      });

      return result;
    } catch (error: unknown) {
      if (error instanceof DomainError) {
        this.events.publish({
          type: 'financing.stage',
          lender: dto.lenderId,
          stage: 'rejected',
          at: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt,
          reason: error.code as DomainErrorCode,
          circuitAssert: CIRCUIT_ASSERT[error.code],
        });
        this.events.publish({
          type: 'financing.rejected',
          reason: error.code as DomainErrorCode,
          lender: dto.lenderId,
          circuitAssert: CIRCUIT_ASSERT[error.code],
        });
      }
      throw error;
    }
  }
}
