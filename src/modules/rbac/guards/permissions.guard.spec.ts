import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import {
  ANY_PERMISSION_KEY,
  PERMISSIONS_KEY,
} from '../../../common/decorators/require-permissions.decorator';
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

  it('RequireAnyPermission passes with at least one match, fails with none', () => {
    const meta = {
      [ANY_PERMISSION_KEY]: [
        PERMISSIONS.EMPLOYEE_READ,
        PERMISSIONS.EMPLOYEE_READ_DIRECTORY,
      ],
    };
    expect(
      make(meta, {
        permissions: [PERMISSIONS.EMPLOYEE_READ_DIRECTORY],
      }).guard.canActivate(
        make(meta, { permissions: [PERMISSIONS.EMPLOYEE_READ_DIRECTORY] })
          .context,
      ),
    ).toBe(true);
    const none = make(meta, { permissions: [PERMISSIONS.AI_CHAT] });
    expect(() => none.guard.canActivate(none.context)).toThrow(
      /Requires one of/,
    );
  });

  it('all-of and any-of combine (both must hold)', () => {
    const meta = {
      [PERMISSIONS_KEY]: [PERMISSIONS.USER_READ],
      [ANY_PERMISSION_KEY]: [
        PERMISSIONS.EMPLOYEE_READ,
        PERMISSIONS.EMPLOYEE_READ_DIRECTORY,
      ],
    };
    const ok = make(meta, {
      permissions: [PERMISSIONS.USER_READ, PERMISSIONS.EMPLOYEE_READ],
    });
    expect(ok.guard.canActivate(ok.context)).toBe(true);
    const missingAll = make(meta, { permissions: [PERMISSIONS.EMPLOYEE_READ] });
    expect(() => missingAll.guard.canActivate(missingAll.context)).toThrow(
      /user:read/,
    );
  });
});
