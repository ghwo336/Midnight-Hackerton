import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * 검증 실패 시 입력값을 메시지에 넣지 않는다. 어떤 필드가 잘못됐는지만 알린다.
 */
@Injectable()
export class ZodValidationPipe<Output, Input = unknown> implements PipeTransform<unknown, Output> {
  constructor(private readonly schema: ZodType<Output, ZodTypeDef, Input>) {}

  transform(value: unknown): Output {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const fields = result.error.issues.map((issue) => issue.path.join('.'));
      throw new BadRequestException({ code: 'VALIDATION_FAILED', fields });
    }
    return result.data;
  }
}
