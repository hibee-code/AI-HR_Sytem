import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../../modules/rbac/permissions.catalogue';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Route needs ALL of the listed permissions. Evaluated by PermissionsGuard
 * after JwtAuthGuard has attached the caller's effective permission set.
 * Routes with no @RequirePermissions() only need a valid login.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
