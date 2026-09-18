import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../../modules/rbac/permissions.catalogue';

export const PERMISSIONS_KEY = 'requiredPermissions';
export const ANY_PERMISSION_KEY = 'requiredAnyPermission';

/**
 * Route needs ALL of the listed permissions. Evaluated by PermissionsGuard
 * after JwtAuthGuard has attached the caller's effective permission set.
 * Routes with no permission decorator only need a valid login.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Route needs AT LEAST ONE of the listed permissions. Combinable with RequirePermissions. */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(ANY_PERMISSION_KEY, permissions);
