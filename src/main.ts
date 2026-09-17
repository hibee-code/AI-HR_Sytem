import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true, // hold logs until pino is wired in
  });

  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  const prefix = config.get('API_PREFIX', { infer: true });
  const isProd = config.get('NODE_ENV', { infer: true }) === 'production';

  // ── HTTP hardening ────────────────────────────────────────────────────
  app.set('trust proxy', 1); // correct client IPs behind a reverse proxy (rate limiting)
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

  // ── Validation ────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // ...and reject them loudly
      transform: true, // plain JSON → DTO class instances
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // ── Swagger ───────────────────────────────────────────────────────────
  if (!isProd) {
    const doc = new DocumentBuilder()
      .setTitle('AI HR System API')
      .setDescription('HR management backend with AI-assisted features')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .build();
    const document = SwaggerModule.createDocument(app, doc);
    SwaggerModule.setup(`${prefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────
  app.enableShutdownHooks();

  await app.listen(port);
  logger.log(
    `Listening on http://localhost:${port}/${prefix}/v1` +
      (isProd ? '' : `  (docs: /${prefix}/docs)`),
  );
}

bootstrap().catch((err) => {
  // Logger may not be initialised yet (e.g. env validation failed).
  console.error(err);
  process.exit(1);
});
