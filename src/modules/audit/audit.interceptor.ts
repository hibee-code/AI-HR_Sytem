import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { mergeMap, Observable } from 'rxjs';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { AUDIT_KEY, AuditSpec } from './audit.decorator';
import { AuditService } from './audit.service';

/** Global: writes one audit row per successful request to an @Audit() handler. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const spec = this.reflector.get<AuditSpec | undefined>(
      AUDIT_KEY,
      ctx.getHandler(),
    );
    if (!spec) return next.handle();

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return next.handle().pipe(
      mergeMap(async (result: unknown) => {
        const fromResult = (result as { id?: unknown } | null)?.id;
        await this.audit.record({
          actorUserId: req.user?.id ?? null,
          action: spec.action,
          resourceType: spec.resourceType,
          resourceId:
            param(req, spec.idParam ?? 'id') ??
            (typeof fromResult === 'string' ? fromResult : null),
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          metadata: {
            ...pick(req.body, spec.bodyKeys),
            ...(spec.fields && isObject(req.body)
              ? { fields: Object.keys(req.body) }
              : {}),
          },
        });
        return result;
      }),
    );
  }
}

function param(req: Request, name: string): string | null {
  const v: unknown = req.params?.[name];
  return typeof v === 'string' ? v : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function pick(body: unknown, keys: string[] = []): Record<string, unknown> {
  if (!isObject(body)) return {};
  return Object.fromEntries(
    keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]),
  );
}
