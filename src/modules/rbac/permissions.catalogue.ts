/**
 * The complete permission catalogue. This is the single source of truth:
 *  - the seeder upserts every entry into the `permissions` table
 *  - controllers reference these constants in @RequirePermissions()
 *  - TypeScript rejects typos at compile time
 *
 * Naming: `<resource>:<action>`. Add a permission here first, then use it.
 * Removing one requires a migration that also cleans role_permissions.
 */
export const PERMISSIONS = {
  // ── Users & access control ────────────────────────────────────────────
  USER_READ: 'user:read',
  USER_INVITE: 'user:invite',
  USER_UPDATE: 'user:update',
  USER_MANAGE_ROLES: 'user:manage_roles',
  USER_SUSPEND: 'user:suspend',
  ROLE_READ: 'role:read',
  ROLE_MANAGE: 'role:manage',

  // ── Employees / org (stage 2) ─────────────────────────────────────────
  EMPLOYEE_READ_SELF: 'employee:read_self',
  /** Org directory: names, department, position, work email. No personal data. */
  EMPLOYEE_READ_DIRECTORY: 'employee:read_directory',
  /** Full records for any employee (HR). Managers get full records of their reports implicitly. */
  EMPLOYEE_READ: 'employee:read',
  EMPLOYEE_CREATE: 'employee:create',
  EMPLOYEE_UPDATE: 'employee:update',
  EMPLOYEE_DELETE: 'employee:delete',
  DEPARTMENT_READ: 'department:read',
  DEPARTMENT_MANAGE: 'department:manage',

  // ── Onboarding (stage 4) ──────────────────────────────────────────────
  ONBOARDING_READ: 'onboarding:read',
  ONBOARDING_MANAGE: 'onboarding:manage',

  // ── Leave & attendance (stage 5) ──────────────────────────────────────
  LEAVE_READ_SELF: 'leave:read_self',
  LEAVE_REQUEST: 'leave:request',
  LEAVE_READ_TEAM: 'leave:read_team',
  LEAVE_APPROVE: 'leave:approve',
  LEAVE_READ_ALL: 'leave:read_all',
  LEAVE_MANAGE_POLICY: 'leave:manage_policy',
  ATTENDANCE_CLOCK: 'attendance:clock',
  ATTENDANCE_READ_TEAM: 'attendance:read_team',
  ATTENDANCE_MANAGE: 'attendance:manage',

  // ── Documents (stage 6) ───────────────────────────────────────────────
  DOCUMENT_READ_SELF: 'document:read_self',
  DOCUMENT_UPLOAD: 'document:upload',
  DOCUMENT_READ_ALL: 'document:read_all',
  DOCUMENT_MANAGE: 'document:manage',

  // ── Performance (stage 7) ─────────────────────────────────────────────
  REVIEW_READ_SELF: 'review:read_self',
  REVIEW_WRITE_TEAM: 'review:write_team',
  REVIEW_MANAGE_CYCLES: 'review:manage_cycles',

  // ── Payroll (stage 8) ─────────────────────────────────────────────────
  PAYROLL_READ_SELF: 'payroll:read_self',
  PAYROLL_MANAGE: 'payroll:manage',

  // ── AI (stages 9–10) ──────────────────────────────────────────────────
  AI_CHAT: 'ai:chat',
  AI_MANAGE_KNOWLEDGE_BASE: 'ai:manage_knowledge_base',
  RECRUITING_READ: 'recruiting:read',
  RECRUITING_MANAGE: 'recruiting:manage',
  RECRUITING_SCREEN: 'recruiting:screen',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] =
  Object.values(PERMISSIONS);

/** Seeded system roles. Names are stable identifiers; never rename. */
export const SYSTEM_ROLES = {
  ADMIN: 'ADMIN',
  HR_MANAGER: 'HR_MANAGER',
  MANAGER: 'MANAGER',
  EMPLOYEE: 'EMPLOYEE',
  RECRUITER: 'RECRUITER',
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

const P = PERMISSIONS;

/** Baseline every logged-in person gets. */
const EMPLOYEE_PERMISSIONS: Permission[] = [
  P.EMPLOYEE_READ_SELF,
  P.EMPLOYEE_READ_DIRECTORY,
  P.DEPARTMENT_READ,
  P.LEAVE_READ_SELF,
  P.LEAVE_REQUEST,
  P.ATTENDANCE_CLOCK,
  P.DOCUMENT_READ_SELF,
  P.DOCUMENT_UPLOAD,
  P.REVIEW_READ_SELF,
  P.PAYROLL_READ_SELF,
  P.AI_CHAT,
];

/** Line manager: everything an employee has, plus their direct reports. */
const MANAGER_PERMISSIONS: Permission[] = [
  ...EMPLOYEE_PERMISSIONS,
  P.LEAVE_READ_TEAM,
  P.LEAVE_APPROVE,
  P.ATTENDANCE_READ_TEAM,
  P.REVIEW_WRITE_TEAM,
];

const HR_MANAGER_PERMISSIONS: Permission[] = [
  ...MANAGER_PERMISSIONS,
  P.USER_READ,
  P.USER_INVITE,
  P.USER_UPDATE,
  P.USER_SUSPEND,
  P.ROLE_READ,
  P.EMPLOYEE_READ,
  P.EMPLOYEE_CREATE,
  P.EMPLOYEE_UPDATE,
  P.EMPLOYEE_DELETE,
  P.DEPARTMENT_MANAGE,
  P.ONBOARDING_READ,
  P.ONBOARDING_MANAGE,
  P.LEAVE_READ_ALL,
  P.LEAVE_MANAGE_POLICY,
  P.ATTENDANCE_MANAGE,
  P.DOCUMENT_READ_ALL,
  P.DOCUMENT_MANAGE,
  P.REVIEW_MANAGE_CYCLES,
  P.PAYROLL_MANAGE,
  P.AI_MANAGE_KNOWLEDGE_BASE,
  P.RECRUITING_READ,
];

const RECRUITER_PERMISSIONS: Permission[] = [
  ...EMPLOYEE_PERMISSIONS,
  P.RECRUITING_READ,
  P.RECRUITING_MANAGE,
  P.RECRUITING_SCREEN,
];

export const SYSTEM_ROLE_DEFINITIONS: Record<
  SystemRole,
  { description: string; permissions: readonly Permission[] }
> = {
  ADMIN: {
    description: 'Full access to every feature and setting',
    permissions: ALL_PERMISSIONS,
  },
  HR_MANAGER: {
    description:
      'Runs HR operations: people, leave, documents, reviews, payroll',
    permissions: dedupe(HR_MANAGER_PERMISSIONS),
  },
  MANAGER: {
    description: 'Line manager for a team: approves leave, writes reviews',
    permissions: dedupe(MANAGER_PERMISSIONS),
  },
  EMPLOYEE: {
    description: 'Standard employee self-service',
    permissions: dedupe(EMPLOYEE_PERMISSIONS),
  },
  RECRUITER: {
    description: 'Manages job openings and candidate screening',
    permissions: dedupe(RECRUITER_PERMISSIONS),
  },
};

function dedupe(list: Permission[]): Permission[] {
  return [...new Set(list)];
}
