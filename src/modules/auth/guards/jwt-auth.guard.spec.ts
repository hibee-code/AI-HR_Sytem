import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { RbacService } from '../../rbac/rbac.service';
import { UserStatus } from '../../users/entities/user.entity';
import { TokenService } from '../token.service';
import { JwtAuthGuard } from './jwt-auth.guard';

function ctx(
  headers: Record<string, string>,
  meta: Record<string, unknown> = {},
) {
  const req: Record<string, unknown> = { headers };
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => meta[key]),
  } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { req, reflector, context };
}

const activeUser = {
  id: 'u1',
  email: 'a@b.c',
  status: UserStatus.ACTIVE,
  roles: ['EMPLOYEE'],
  permissions: [],
  passwordChangedAt: null as number | null,
};

describe('JwtAuthGuard', () => {
  let tokens: { verifyAccessToken: jest.Mock };
  let rbac: { getAuthUser: jest.Mock };

  beforeEach(() => {
    tokens = { verifyAccessToken: jest.fn() };
    rbac = { getAuthUser: jest.fn() };
  });

  const guard = (reflector: Reflector) =>
    new JwtAuthGuard(
      reflector,
      tokens as unknown as TokenService,
      rbac as unknown as RbacService,
    );

  it('lets @Public() routes through without a token', async () => {
    const { reflector, context } = ctx({}, { [IS_PUBLIC_KEY]: true });
    await expect(guard(reflector).canActivate(context)).resolves.toBe(true);
    expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a missing or malformed Authorization header', async () => {
    const cases: Record<string, string>[] = [
      {},
      { authorization: 'Basic abc' },
      { authorization: 'Bearer' },
    ];
    for (const headers of cases) {
      const { reflector, context } = ctx(headers);
      await expect(guard(reflector).canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    }
  });

  it('rejects an invalid signature / expired token', async () => {
    tokens.verifyAccessToken.mockRejectedValue(new Error('jwt expired'));
    const { reflector, context } = ctx({ authorization: 'Bearer bad' });
    await expect(guard(reflector).canActivate(context)).rejects.toThrow(
      /Invalid or expired/,
    );
  });

  it('attaches req.user for a valid token and active user', async () => {
    tokens.verifyAccessToken.mockResolvedValue({
      sub: 'u1',
      email: 'a@b.c',
      iat: 1000,
    });
    rbac.getAuthUser.mockResolvedValue(activeUser);
    const { req, reflector, context } = ctx({ authorization: 'Bearer good' });

    await expect(guard(reflector).canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual(activeUser);
  });

  it('rejects suspended users even with a valid token', async () => {
    tokens.verifyAccessToken.mockResolvedValue({
      sub: 'u1',
      email: 'a@b.c',
      iat: 1000,
    });
    rbac.getAuthUser.mockResolvedValue({
      ...activeUser,
      status: UserStatus.SUSPENDED,
    });
    const { reflector, context } = ctx({ authorization: 'Bearer good' });
    await expect(guard(reflector).canActivate(context)).rejects.toThrow(
      /not active/,
    );
  });

  it('rejects tokens issued before the last password change', async () => {
    tokens.verifyAccessToken.mockResolvedValue({
      sub: 'u1',
      email: 'a@b.c',
      iat: 1000,
    });
    rbac.getAuthUser.mockResolvedValue({
      ...activeUser,
      passwordChangedAt: 2000,
    });
    const { reflector, context } = ctx({ authorization: 'Bearer good' });
    await expect(guard(reflector).canActivate(context)).rejects.toThrow(
      /password change/,
    );
  });

  it('accepts tokens issued after the last password change', async () => {
    tokens.verifyAccessToken.mockResolvedValue({
      sub: 'u1',
      email: 'a@b.c',
      iat: 3000,
    });
    rbac.getAuthUser.mockResolvedValue({
      ...activeUser,
      passwordChangedAt: 2000,
    });
    const { reflector, context } = ctx({ authorization: 'Bearer good' });
    await expect(guard(reflector).canActivate(context)).resolves.toBe(true);
  });
});
