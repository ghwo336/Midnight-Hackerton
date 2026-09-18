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
if (existsSync(envFile)) process.loadEnvFile(envFile);

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
