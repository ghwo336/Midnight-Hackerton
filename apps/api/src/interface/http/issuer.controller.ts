import {
  BadRequestException, Body, Controller, Get, Inject, NotFoundException, Post, UsePipes,
} from '@nestjs/common';
import { IssueInvoiceUseCase } from '../../application/issue-invoice.usecase.js';
import { CHAIN_READER, type ChainReader } from '../../application/ports/chain.gateway.js';
import { OnceEventsService } from '../events/once-events.service.js';
import { SUPPLIER_ID } from '../../config/demo.config.js';
import {
  ApproveInvoiceSchema, IssueInvoiceSchema,
  type ApproveInvoiceDto, type IssueInvoiceDto,
} from './dto/schemas.js';
import {
  INVOICE_REQUESTS, type InvoiceRequestQueue,
} from '../../application/ports/invoice-requests.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

/**
 * 발급 기관 화면용.
 *
 * 발급 기관은 채권을 만드는 주체이므로 자기가 방금 발급한 원문을 안다.
 * 그래서 발급 요청 본문에 상세가 들어온다. 하지만 **응답에는 담지 않는다.**
 * 발급 뒤 원문은 납품업체 저장소에만 남고, 이 컨트롤러는 원장에 올라간
 * 공개값(리프·루트·건수)만 돌려준다 (CONTEXT §4.2).
 */
@Controller('issuer')
export class IssuerController {
  constructor(
    @Inject(IssueInvoiceUseCase) private readonly issueInvoice: IssueInvoiceUseCase,
    @Inject(CHAIN_READER) private readonly reader: ChainReader,
    @Inject(OnceEventsService) private readonly events: OnceEventsService,
    @Inject(INVOICE_REQUESTS) private readonly requests: InvoiceRequestQueue,
  ) {}

  /** 승인 대기 중인 등록 요청. */
  @Get('requests')
  async pending() {
    return { requests: await this.requests.listPending() };
  }

  /**
   * 등록 요청 승인.
   *
   * 승인해야 Merkle 리프가 들어가고 루트가 바뀐다. 승인 전에는 회로의
   * checkRoot 가 그 채권을 거부한다 (A4 가 검증하는 지점).
   */
  @Post('requests/approve')
  @UsePipes(new ZodValidationPipe(ApproveInvoiceSchema))
  async approve(@Body() dto: ApproveInvoiceDto) {
    const request = await this.requests.find(dto.requestId);
    if (!request) throw new NotFoundException({ code: 'REQUEST_NOT_FOUND' });
    if (request.status !== 'pending') {
      throw new BadRequestException({ code: 'REQUEST_ALREADY_HANDLED' });
    }

    const rootBefore = await this.reader.getIssuerRoot();
    const { invoiceId } = await this.issueInvoice.execute({
      supplierId: request.supplierId,
      faceAmount: BigInt(request.faceAmount),
      detail: request.detail,
      risk: request.risk,
    });
    request.status = 'approved';
    request.invoiceId = invoiceId;

    this.events.publish({ type: 'invoice.issued', invoiceId });

    return {
      requestId: request.id,
      invoiceId,
      rootBefore,
      rootAfter: await this.reader.getIssuerRoot(),
      invoiceCount: await this.reader.getInvoiceCount(),
    };
  }

  /** 발급 기관 콘솔 상태. 전부 공개값이다. */
  @Get('state')
  async state() {
    return {
      issuerId: await this.reader.getIssuerId(),
      issuerPk: await this.reader.getIssuerPk(),
      issuerRoot: await this.reader.getIssuerRoot(),
      invoiceCount: await this.reader.getInvoiceCount(),
      ltvBps: (await this.reader.getLtvBps()).toString(),
      blockHeight: await this.reader.getBlockHeight(),
    };
  }

  /**
   * 채권 발급.
   *
   * 루트가 발급 전후로 바뀐다. 그 전이가 발급 기관 화면의 유일한 증거다:
   * 원문은 어디에도 올라가지 않았는데 트리는 자랐다.
   */
  @Post('invoices')
  @UsePipes(new ZodValidationPipe(IssueInvoiceSchema))
  async issue(@Body() dto: IssueInvoiceDto) {
    const rootBefore = await this.reader.getIssuerRoot();

    const { invoiceId } = await this.issueInvoice.execute({
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

    this.events.publish({ type: 'invoice.issued', invoiceId });

    return {
      // 발급 기관은 자기가 만든 채권의 식별자를 안다. 원문은 돌려주지 않는다.
      invoiceId,
      rootBefore,
      rootAfter: await this.reader.getIssuerRoot(),
      invoiceCount: await this.reader.getInvoiceCount(),
    };
  }
}
