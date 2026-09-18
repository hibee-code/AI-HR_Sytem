import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { PERMISSIONS_KEY } from '../../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../permissions.catalogue';
import { PermissionsGuard } from './permissions.guard';

function make(meta: Record<string, unknown>, user?: { permissions: string[] }) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => meta[key]),
  } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return { guard: new PermissionsGuard(reflector), context };
}

describe('PermissionsGuard', () => {
  it('passes routes with no @RequirePermissions', () => {
    const { guard, context } = make({}, { permissions: [] });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('passes @Public routes regardless of user', () => {
    const { guard, context } = make({
      [IS_PUBLIC_KEY]: true,
      [PERMISSIONS_KEY]: [PERMISSIONS.ROLE_MANAGE],
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('requires ALL listed permissions', () => {
    const { guard, context } = make(
      { [PERMISSIONS_KEY]: [PERMISSIONS.USER_READ, PERMISSIONS.USER_INVITE] },
      { permissions: [PERMISSIONS.USER_READ] },
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow(/user:invite/);
  });

  it('passes when the user holds every permission', () => {
    const { guard, context } = make(
      { [PERMISSIONS_KEY]: [PERMISSIONS.USER_READ, PERMISSIONS.USER_INVITE] },
      {
        permissions: [
          PERMISSIONS.USER_INVITE,
          PERMISSIONS.USER_READ,
          PERMISSIONS.AI_CHAT,
        ],
      },
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('forbids when no user is attached (guard misordering safety net)', () => {
    const { guard, context } = make({
      [PERMISSIONS_KEY]: [PERMISSIONS.USER_READ],
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
