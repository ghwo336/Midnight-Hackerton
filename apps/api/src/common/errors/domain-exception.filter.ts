import {
  Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter,
} from '@nestjs/common';
import { CIRCUIT_ASSERT, DomainError, ERROR_HTTP_MAP } from '@once/domain';
import type { Response } from 'express';

/**
 * 도메인 오류 → HTTP 매핑 (SPEC §8.3).
 *
 * 409 NULLIFIER_ALREADY_USED가 데모에서 가장 중요한 응답이다.
 * 프론트는 이 코드로 "중복 담보 · 지급 거부" 화면을 띄운다.
 *
 * 응답 본문에는 code와 안전한 메시지만 담는다. 스택 트레이스나 원본
 * 오류 문자열을 절대 내보내지 않는다.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      const status = ERROR_HTTP_MAP[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
      response.status(status).json({
        code: exception.code,
        message: exception.message,
        circuitAssert: CIRCUIT_ASSERT[exception.code],
      });
      return;
    }

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ code: 'INTERNAL_ERROR', message: 'unexpected error' });
  }
}
