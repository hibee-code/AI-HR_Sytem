import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth-user.interface';

/**
 * `@CurrentUser() user: AuthUser` — the caller, as attached by JwtAuthGuard.
 * `@CurrentUser('id') id: string` — a single field.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);

/** `@CurrentSession()` — id of the caller's session (refresh-token family). */
export const CurrentSession = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<Request & { sessionId?: string }>().sessionId,
);
