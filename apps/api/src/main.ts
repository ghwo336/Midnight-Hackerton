import 'reflect-metadata';
import { existsSync } from 'node:fs';

/*
 * .env 를 읽는다. 없으면 그냥 넘어간다.
 *
 * 심사 경로는 .env 없이 돌아야 하고(local-circuit 기본값), 실제 체인에
 * 붙일 때만 CHAIN_MODE·CONTRACT_ADDRESS·DEPLOY_BLOCK 이 필요하다.
 * dotenv 를 새로 넣지 않고 Node 내장 loadEnvFile 을 쓴다.
 */
const envFile = new URL('../../../.env', import.meta.url).pathname;
if (existsSync(envFile)) {
  /*
   * loadEnvFile 은 Node 20.12 부터 있다. 그 아래 버전에서 .env 를 만들면
   * "process.loadEnvFile is not a function" 으로 죽는데, 그 문구만 보고
   * Node 버전 문제라는 걸 알기 어렵다. 무엇이 필요한지 말하고 멈춘다.
   *
   * 심사 경로는 여기 들어오지 않는다. .env 없이 local-circuit 으로 돈다.
   */
  if (typeof process.loadEnvFile !== 'function') {
    throw new Error(
      `.env 를 읽으려면 Node 20.12 이상이 필요하다 (지금 ${process.version}). ` +
        '.env 를 지우면 시뮬레이터 모드로 그대로 돌아간다.',
    );
  }
  process.loadEnvFile(envFile);
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { DomainExceptionFilter } from './common/errors/domain-exception.filter.js';
import { MaskingLoggingInterceptor } from './common/logging/masking.interceptor.js';
import { loadEnv } from './config/demo.config.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });

  app.enableCors({ origin: env.WEB_ORIGIN.split(',').map((value) => value.trim()) });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new DomainExceptionFilter());
  app.useGlobalInterceptors(new MaskingLoggingInterceptor());

  await app.listen(env.PORT);
}

void bootstrap();
