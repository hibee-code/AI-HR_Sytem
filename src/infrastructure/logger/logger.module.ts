import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Env } from '../../config/env.schema';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Structured JSON logging via pino. Every request gets a correlation id
 * (honouring an incoming X-Correlation-Id header, otherwise generating one),
 * which is echoed back in the response and attached to every log line
 * emitted during that request via pino-http's request-scoped child logger.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isProd = config.get('NODE_ENV', { infer: true }) === 'production';
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const incoming = req.headers[CORRELATION_ID_HEADER];
              const id =
                (Array.isArray(incoming) ? incoming[0] : incoming) ||
                randomUUID();
              res.setHeader(CORRELATION_ID_HEADER, id);
              return id;
            },
            customProps: (req: IncomingMessage) => ({ correlationId: req.id }),
            // Never log auth headers or cookies.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
              ],
              censor: '[REDACTED]',
            },
            // Health-check noise is dropped below info.
            customLogLevel: (req, res, err) => {
              if (req.url?.includes('/health')) return 'debug';
              if (err || res.statusCode >= 500) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },
            autoLogging: true,
            transport: isProd
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    colorize: true,
                    translateTime: 'HH:MM:ss',
                  },
                },
          },
        };
      },
    }),
  ],
})
export class LoggerModule {}
