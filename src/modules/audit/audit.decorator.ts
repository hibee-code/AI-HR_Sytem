import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

export interface AuditSpec {
  /** e.g. 'payroll.run.approve' — `<resource>.<verb>`. */
  action: string;
  /** e.g. 'payroll_run'. */
  resourceType: string;
  /** Route param holding the resource id (default `id`); falls back to the response's `id`. */
  idParam?: string;
  /** Request-body fields safe to keep (never passwords or personal data). */
  bodyKeys?: string[];
  /** Record the names (not values) of the fields sent — for PATCH-style edits. */
  fields?: boolean;
}

/**
 * Records the action in the audit log after the handler succeeds.
 * Failed requests are not recorded here (they changed nothing).
 */
export const Audit = (
  action: string,
  resourceType: string,
  options: Pick<AuditSpec, 'idParam' | 'bodyKeys' | 'fields'> = {},
) =>
  SetMetadata(AUDIT_KEY, {
    action,
    resourceType,
    ...options,
  } satisfies AuditSpec);
