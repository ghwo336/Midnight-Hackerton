import {
  Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor,
} from '@nestjs/common';
import { tap } from 'rxjs';
import type { Request } from 'express';
import { maskSecrets } from './mask.js';

/**
 * 전역 로깅 인터셉터. 요청 본문을 그대로 찍지 않는다 (SPEC §8.6).
 */
@Injectable()
export class MaskingLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('http');

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    const started = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(
            `${request.method} ${request.url} ${Date.now() - started}ms ${JSON.stringify(
              maskSecrets(request.body),
            )}`,
          );
        },
        error: (error: unknown) => {
          const code = error instanceof Error ? error.name : 'Error';
          // 오류 메시지 본문을 찍지 않는다. 코드만 남긴다.
          this.logger.warn(`${request.method} ${request.url} rejected ${code}`);
        },
      }),
    );
  }
}
