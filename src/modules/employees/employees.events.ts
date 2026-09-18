/**
 * Domain events from the employees module. Onboarding (stage 4) and
 * notifications (stage 3) subscribe; this module never imports them.
 */
export const EMPLOYEE_EVENTS = {
  CREATED: 'employee.created',
  ASSIGNMENT_CHANGED: 'employee.assignment_changed',
  STATUS_CHANGED: 'employee.status_changed',
  TERMINATED: 'employee.terminated',
} as const;

export class EmployeeCreatedEvent {
  constructor(
    public readonly employeeId: string,
    public readonly userId: string | null,
    public readonly hireDate: string,
    public readonly departmentId: string,
    public readonly managerId: string | null,
    public readonly actorUserId: string,
  ) {}
}

export class EmployeeAssignmentChangedEvent {
  constructor(
    public readonly employeeId: string,
    public readonly changeType: string,
    public readonly effectiveDate: string,
    public readonly historyId: string,
    public readonly actorUserId: string,
  ) {}
}

export class EmployeeStatusChangedEvent {
  constructor(
    public readonly employeeId: string,
    public readonly fromStatus: string,
    public readonly toStatus: string,
    public readonly effectiveDate: string,
    public readonly actorUserId: string,
  ) {}
}

export class EmployeeTerminatedEvent {
  constructor(
    public readonly employeeId: string,
    public readonly userId: string | null,
    public readonly terminationDate: string,
    public readonly actorUserId: string,
  ) {}
}
