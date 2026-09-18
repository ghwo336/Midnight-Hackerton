import { Body, Controller, Get, Inject, Post, UsePipes } from '@nestjs/common';
import type { DomainErrorCode } from '@once/domain';
import { CIRCUIT_ASSERT, DomainError } from '@once/domain';
import { ListInvoicesUseCase } from '../../application/list-invoices.usecase.js';
import { RepayLoanUseCase } from '../../application/repay-loan.usecase.js';
import { CHAIN_READER, type ChainReader } from '../../application/ports/chain.gateway.js';
import {
  INVOICE_REQUESTS, type InvoiceRequestQueue,
} from '../../application/ports/invoice-requests.js';
import { RequestFinancingUseCase } from '../../application/request-financing.usecase.js';
import { OnceEventsService } from '../events/once-events.service.js';
import { SUPPLIER_ADDRESS, SUPPLIER_ID } from '../../config/demo.config.js';
import {
  RepayLoanSchema, RequestFinancingSchema, RequestInvoiceSchema,
  type RepayLoanDto, type RequestFinancingDto, type RequestInvoiceDto,
} from './dto/schemas.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

@Controller('supplier')
export class SupplierController {
  constructor(
    @Inject(ListInvoicesUseCase) private readonly listInvoices: ListInvoicesUseCase,
    @Inject(RequestFinancingUseCase) private readonly requestFinancing: RequestFinancingUseCase,
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

  /** 상환. 담보는 풀리지 않는다 (A10). */
  @Post('repay')
  @UsePipes(new ZodValidationPipe(RepayLoanSchema))
  async repay(@Body() dto: RepayLoanDto) {
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

  @Post('financing')
  @UsePipes(new ZodValidationPipe(RequestFinancingSchema))
  async financing(@Body() dto: RequestFinancingDto) {
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
