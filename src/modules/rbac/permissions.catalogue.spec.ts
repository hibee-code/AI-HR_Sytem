import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  SYSTEM_ROLE_DEFINITIONS,
  SYSTEM_ROLES,
} from './permissions.catalogue';

describe('permissions catalogue', () => {
  it('every permission is resource:action and unique', () => {
    for (const p of ALL_PERMISSIONS) expect(p).toMatch(/^[a-z_]+:[a-z_]+$/);
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('every system role only references catalogue permissions', () => {
    for (const def of Object.values(SYSTEM_ROLE_DEFINITIONS)) {
      for (const p of def.permissions) expect(ALL_PERMISSIONS).toContain(p);
      expect(new Set(def.permissions).size).toBe(def.permissions.length);
    }
  });

  it('ADMIN holds everything; EMPLOYEE ⊂ MANAGER ⊂ HR_MANAGER', () => {
    const perms = (r: keyof typeof SYSTEM_ROLES) =>
      new Set(SYSTEM_ROLE_DEFINITIONS[r].permissions);
    expect(perms('ADMIN').size).toBe(ALL_PERMISSIONS.length);

    const isSubset = (a: Set<string>, b: Set<string>) =>
      [...a].every((x) => b.has(x));
    expect(isSubset(perms('EMPLOYEE'), perms('MANAGER'))).toBe(true);
    expect(isSubset(perms('MANAGER'), perms('HR_MANAGER'))).toBe(true);
  });

  it('least privilege: EMPLOYEE cannot approve leave or manage users', () => {
    const employee = SYSTEM_ROLE_DEFINITIONS.EMPLOYEE.permissions;
    expect(employee).not.toContain(PERMISSIONS.LEAVE_APPROVE);
    expect(employee).not.toContain(PERMISSIONS.USER_INVITE);
    expect(employee).not.toContain(PERMISSIONS.ROLE_MANAGE);
  });
});
