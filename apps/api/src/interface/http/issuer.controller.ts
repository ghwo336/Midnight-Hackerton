import {
  BadRequestException, Body, Controller, Get, Inject, NotFoundException, Post, UsePipes,
} from '@nestjs/common';
import { ServerCannotSignError } from '@once/domain';
import { IssueInvoiceUseCase } from '../../application/issue-invoice.usecase.js';
import { PrepareIssuanceUseCase } from '../../application/prepare-issuance.usecase.js';
import { ConfirmIssuanceUseCase } from '../../application/confirm-issuance.usecase.js';
import { isPreprodMode } from '../../infrastructure/chain/network.config.js';
import { CHAIN_READER, type ChainReader } from '../../application/ports/chain.gateway.js';
import { OnceEventsService } from '../events/once-events.service.js';
import { SUPPLIER_ID } from '../../config/demo.config.js';
import {
  ApproveInvoiceSchema, ConfirmIssuanceSchema, IssueInvoiceSchema,
  type ApproveInvoiceDto, type ConfirmIssuanceDto, type IssueInvoiceDto,
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
    @Inject(PrepareIssuanceUseCase) private readonly prepareIssuance: PrepareIssuanceUseCase,
    @Inject(ConfirmIssuanceUseCase) private readonly confirmIssuance: ConfirmIssuanceUseCase,
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
    // 실제 체인에서는 지갑이 서명한다. approve/prepare → confirm 으로 간다.
    if (isPreprodMode()) throw new ServerCannotSignError();
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

  /**
   * 발급 준비. 실제 체인 경로의 첫 단계다.
   *
   * 서버가 입력을 검증하고 리프를 계산해 건넨다. 증명·서명·제출은
   * 브라우저가 한다 — 발급 기관 비밀키가 그 기기에만 있고, 회로가
   * `assert(issuerPublicKey(issuerSecret()) == issuerPk)` 로 그걸 본다.
   *
   * 나가는 것은 리프 해시뿐이다. 채권 원문은 서버에 남는다.
   */
  @Post('invoices/prepare')
  @UsePipes(new ZodValidationPipe(IssueInvoiceSchema))
  async prepareIssue(@Body() dto: IssueInvoiceDto) {
    return this.prepareIssuance.execute({
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
  }

  /** 등록 요청 승인 준비. 같은 회로를 같은 방식으로 부른다. */
  @Post('requests/approve/prepare')
  @UsePipes(new ZodValidationPipe(ApproveInvoiceSchema))
  async prepareApprove(@Body() dto: ApproveInvoiceDto) {
    const request = await this.requests.find(dto.requestId);
    if (!request) throw new NotFoundException({ code: 'REQUEST_NOT_FOUND' });
    if (request.status !== 'pending') {
      throw new BadRequestException({ code: 'REQUEST_ALREADY_HANDLED' });
    }
    return this.prepareIssuance.execute({
      supplierId: request.supplierId,
      faceAmount: BigInt(request.faceAmount),
      detail: request.detail,
      risk: request.risk,
      requestId: request.id,
    });
  }

  /**
   * 브라우저가 리프를 올렸다는 보고.
   *
   * 발급자 트리에 그 리프가 실제로 있는지 확인한 뒤에만 기록한다.
   */
  @Post('invoices/confirm')
  @UsePipes(new ZodValidationPipe(ConfirmIssuanceSchema))
  async confirmIssue(@Body() dto: ConfirmIssuanceDto) {
    const result = await this.confirmIssuance.execute({
      issuanceId: dto.issuanceId,
      txHash: dto.txHash as `0x${string}` | null,
      block: dto.block,
    });

    if (result.requestId !== null) {
      const request = await this.requests.find(result.requestId);
      if (request) {
        request.status = 'approved';
        request.invoiceId = result.invoiceId;
      }
    }

    this.events.publish({ type: 'invoice.issued', invoiceId: result.invoiceId });
    return result;
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
    // 실제 체인에서는 지갑이 서명한다. invoices/prepare → confirm 으로 간다.
    if (isPreprodMode()) throw new ServerCannotSignError();
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
