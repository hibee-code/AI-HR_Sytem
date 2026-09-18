import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '../../../common/auth/auth-user.interface';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { UserStatus } from '../../users/entities/user.entity';
import { RbacService } from '../../rbac/rbac.service';
import { TokenService } from '../token.service';

/**
 * Global guard. Every route requires a valid Bearer access token unless it
 * (or its controller) is marked @Public(). On success, attaches `req.user`
 * (an AuthUser) for PermissionsGuard and @CurrentUser().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const token = extractBearer(req);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let payload;
    try {
      payload = await this.tokens.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.rbac.getAuthUser(payload.sub);
    if (!user) throw new UnauthorizedException('User no longer exists');
    if (user.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException('Account is not active');
    if (
      user.passwordChangedAt !== null &&
      payload.iat !== undefined &&
      payload.iat < user.passwordChangedAt
    ) {
      throw new UnauthorizedException('Token issued before password change');
    }

    req.user = user;
    return true;
  }
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
