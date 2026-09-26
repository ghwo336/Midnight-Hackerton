import {
  Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter,
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

    /*
     * 검증 실패(400)·없는 라우트(404) 같은 Nest 오류는 상태를 그대로 둔다.
     * 전부 500 으로 뭉개면 "입력이 틀렸다" 와 "서버가 죽었다" 가 구분되지
     * 않는다. 실제로 확정 보고의 txHash 형식 불일치가 500 으로만 보여 원인을
     * 한참 못 찾았다. 본문은 우리가 만든 { code, ... } 만 내보낸다.
     */
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const code =
        typeof body === 'object' && body !== null && 'code' in body
          ? String((body as { code: unknown }).code)
          : status === HttpStatus.NOT_FOUND ? 'NOT_FOUND' : 'HTTP_ERROR';
      const fields =
        typeof body === 'object' && body !== null && 'fields' in body
          ? (body as { fields: unknown }).fields
          : undefined;
      response.status(status).json(fields === undefined ? { code } : { code, fields });
      return;
    }

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ code: 'INTERNAL_ERROR', message: 'unexpected error' });
  }
}
