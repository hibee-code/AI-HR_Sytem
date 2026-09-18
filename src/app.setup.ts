import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { Env } from './config/env.schema';

/**
 * Everything that turns a bare Nest app into *this* API: security headers,
 * CORS, routing prefix/versioning, validation and serialisation.
 * Shared by main.ts and the e2e tests so they can never drift apart.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<Env, true>);
  const prefix = config.get('API_PREFIX', { infer: true });

  // ── HTTP hardening ────────────────────────────────────────────────────
  (app as NestExpressApplication).set('trust proxy', 1); // real client IPs behind a proxy
  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id'],
  });

  // ── Routing ───────────────────────────────────────────────────────────
  app.setGlobalPrefix(prefix, { exclude: ['health/live', 'health/ready'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // ── Validation & serialisation ────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // ...and reject them loudly
      transform: true, // plain JSON → DTO class instances
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  // Entities pass through class-transformer on the way out, honouring @Exclude().
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  app.enableShutdownHooks();
}

/** Base path every versioned route lives under, e.g. `/api/v1`. */
export function apiBasePath(app: INestApplication): string {
  const prefix = app
    .get(ConfigService<Env, true>)
    .get('API_PREFIX', { infer: true });
  return `/${prefix}/v1`;
}
