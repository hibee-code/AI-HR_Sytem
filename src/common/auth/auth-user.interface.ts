import type { Permission } from '../../modules/rbac/permissions.catalogue';
import type { UserStatus } from '../../modules/users/entities/user.entity';

/**
 * What every authenticated request carries in `req.user`.
 * Built once per request by JwtAuthGuard from the token + a cached lookup;
 * never holds the full entity so handlers can't leak password hashes.
 */
export interface AuthUser {
  id: string;
  email: string;
  status: UserStatus;
  roles: string[];
  permissions: Permission[];
  /** Epoch seconds of the last password change; access tokens issued before it are rejected. */
  passwordChangedAt: number | null;
}

/** Claims we put in the access JWT. Keep small: it's on every request. */
export interface AccessTokenPayload {
  /** user id */
  sub: string;
  email: string;
  /** issued-at (seconds) — set by the JWT lib, read back for password-change invalidation */
  iat?: number;
  exp?: number;
}
