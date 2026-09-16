import 'reflect-metadata';
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
