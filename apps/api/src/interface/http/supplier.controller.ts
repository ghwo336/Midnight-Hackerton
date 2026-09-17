import { Body, Controller, Get, Inject, Post, UsePipes } from '@nestjs/common';
import type { DomainErrorCode } from '@once/domain';
import { CIRCUIT_ASSERT, DomainError } from '@once/domain';
import { ListInvoicesUseCase } from '../../application/list-invoices.usecase.js';
import { RequestFinancingUseCase } from '../../application/request-financing.usecase.js';
import { OnceEventsService } from '../events/once-events.service.js';
import { SUPPLIER_ADDRESS, SUPPLIER_ID } from '../../config/demo.config.js';
import { RequestFinancingSchema, type RequestFinancingDto } from './dto/schemas.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

@Controller('supplier')
export class SupplierController {
  constructor(
    @Inject(ListInvoicesUseCase) private readonly listInvoices: ListInvoicesUseCase,
    @Inject(RequestFinancingUseCase) private readonly requestFinancing: RequestFinancingUseCase,
    @Inject(OnceEventsService) private readonly events: OnceEventsService,
  ) {}

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
