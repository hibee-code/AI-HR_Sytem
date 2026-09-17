import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { QueryFailedError } from 'typeorm';

/**
 * Uniform error envelope for every response, so clients never have to
 * special-case Nest's default shape vs. unexpected crashes.
 */
export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  correlationId?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { statusCode, error, message } = this.normalise(exception);

    const body: ErrorResponseBody = {
      statusCode,
      error,
      message,
      path: req.url,
      timestamp: new Date().toISOString(),
      correlationId: (req as Request & { id?: string }).id,
    };

    if (statusCode >= 500) {
      this.logger.error(
        { err: exception, correlationId: body.correlationId, path: req.url },
        'Unhandled exception',
      );
    }

    res.status(statusCode).json(body);
  }

  private normalise(
    exception: unknown,
  ): Pick<ErrorResponseBody, 'statusCode' | 'error' | 'message'> {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        return { statusCode: status, error: exception.name, message: payload };
      }
      const p = payload as { error?: string; message?: string | string[] };
      return {
        statusCode: status,
        error: p.error ?? exception.name,
        message: p.message ?? exception.message,
      };
    }

    // Postgres unique-violation → 409 rather than a leaked 500.
    if (exception instanceof QueryFailedError) {
      const code = (
        exception as QueryFailedError & { driverError?: { code?: string } }
      ).driverError?.code;
      if (code === '23505') {
        return {
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'Resource already exists',
        };
      }
      if (code === '23503') {
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: 'Referenced resource does not exist',
        };
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    };
  }
}
