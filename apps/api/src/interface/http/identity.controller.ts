import { Body, Controller, Get, Inject, Param, Post, UsePipes } from '@nestjs/common';
import { LENDER_LABELS } from '../../config/demo.config.js';
import {
  IDENTITY_REGISTRY, type IdentityRegistry,
} from '../../application/ports/identity.registry.js';
import { ClaimRoleSchema, type ClaimRoleDto } from './dto/schemas.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

/**
 * 계정이 역할을 정한다.
 *
 * 화면에 "어느 역할로 볼까요" 선택을 두지 않기 위한 경로다. 접속한 지갑
 * 주소로 무엇을 할 수 있는지 물어보고, 해당 화면으로 바로 들어간다.
 *
 * 여기서 돌려주는 것은 역할과 표시용 이름뿐이다. 채권 원문은 나가지 않는다.
 */
@Controller('identity')
export class IdentityController {
  constructor(
    @Inject(IDENTITY_REGISTRY) private readonly registry: IdentityRegistry,
  ) {}

  @Get(':address')
  async resolve(@Param('address') address: string) {
    const record = await this.registry.resolve(address);
    return {
      ...record,
      lenderLabel: record.lenderId === null ? null : LENDER_LABELS[record.lenderId],
    };
  }

  /**
   * 역할을 가져간다.
   *
   * 데모이므로 아무나 금융사가 될 수 있다. 실제 제품이라면 심사와 인가가
   * 있어야 하는 지점이고, 그 사실을 README 의 보장 범위에 적어 둔다.
   */
  @Post('claim')
  @UsePipes(new ZodValidationPipe(ClaimRoleSchema))
  async claim(@Body() dto: ClaimRoleDto) {
    if (dto.role === 'lender') {
      const lenderId = await this.registry.claimLender(dto.address);
      return {
        ok: lenderId !== null,
        lenderId,
        lenderLabel: lenderId === null ? null : LENDER_LABELS[lenderId],
        reason: lenderId === null ? 'LENDER_SLOTS_TAKEN' : null,
      };
    }
    const supplierId = await this.registry.claimSupplier(dto.address);
    return { ok: true, supplierId, reason: null };
  }
}
