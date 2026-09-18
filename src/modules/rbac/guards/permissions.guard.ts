import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '../../../common/auth/auth-user.interface';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import {
  ANY_PERMISSION_KEY,
  PERMISSIONS_KEY,
} from '../../../common/decorators/require-permissions.decorator';
import type { Permission } from '../permissions.catalogue';

/**
 * Enforces @RequirePermissions(). Runs after JwtAuthGuard (guard order =
 * registration order in AppModule), so `req.user` is already populated.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const required =
      this.reflector.getAllAndOverride<Permission[] | undefined>(
        PERMISSIONS_KEY,
        targets,
      ) ?? [];
    const anyOf =
      this.reflector.getAllAndOverride<Permission[] | undefined>(
        ANY_PERMISSION_KEY,
        targets,
      ) ?? [];
    if (required.length === 0 && anyOf.length === 0) return true;

    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>().user;
    if (!user) throw new ForbiddenException();

    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }
    if (anyOf.length > 0 && !anyOf.some((p) => user.permissions.includes(p))) {
      throw new ForbiddenException(`Requires one of: ${anyOf.join(', ')}`);
    }
    return true;
  }
}
