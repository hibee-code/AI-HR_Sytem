import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { addDays, todayIso } from '../../common/utils/date';
import { EmployeeStatus } from '../employees/entities/employee.entity';
import { EmployeesService } from '../employees/employees.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { UserStatus } from '../users/entities/user.entity';
import { LeaveBalance } from './entities/leave-balance.entity';
import {
  HalfDay,
  LeaveRequest,
  LeaveRequestStatus,
} from './entities/leave-request.entity';
import { LeavePolicyService } from './leave-policy.service';
import { LeaveRequestsService, isLongLeave } from './leave-requests.service';

const actor = (o: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u-mgr',
  email: 'm@x',
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [PERMISSIONS.LEAVE_APPROVE],
  passwordChangedAt: null,
  ...o,
});

describe('isLongLeave', () => {
  it('30 calendar days or more', () => {
    expect(
      isLongLeave({ startDate: '2026-10-01', endDate: '2026-10-30' }),
    ).toBe(true);
    expect(
      isLongLeave({ startDate: '2026-10-01', endDate: '2026-10-29' }),
    ).toBe(false);
  });
});

describe('LeaveRequestsService', () => {
  let service: LeaveRequestsService;
  let requests: Record<string, jest.Mock>;
  let policy: Record<string, jest.Mock>;
  let employees: Record<string, jest.Mock>;
  let notifications: { notify: jest.Mock };

  const annual = {
    id: 't1',
    name: 'Annual',
    isActive: true,
    allowHalfDay: true,
    requiresBalance: true,
  };
  const employee = {
    id: 'e1',
    userId: 'u-emp',
    firstName: 'Jane',
    fullName: 'Jane Doe',
    hireDate: '2025-01-01',
    status: EmployeeStatus.ACTIVE,
    manager: { userId: 'u-mgr' },
  };
  const balance = () =>
    Object.assign(new LeaveBalance(), {
      entitled: 20,
      carriedOver: 0,
      carryOverExpiresOn: null,
      adjustment: 0,
      used: 0,
      pending: 0,
    });

  beforeEach(async () => {
    requests = {
      findOne: jest.fn(async () => null),
      create: jest.fn((v) => Object.assign(new LeaveRequest(), v)),
      save: jest.fn(async (r) => Object.assign(r, { id: 'r1' })),
      update: jest.fn(),
      find: jest.fn(async () => []),
    };
    policy = {
      findType: jest.fn(async () => annual),
      countWorkingDays: jest.fn(async () => 3),
      ensureBalance: jest.fn(async () => balance()),
      applyToBalance: jest.fn(),
    };
    employees = {
      findById: jest.fn(async () => employee),
      findByUserId: jest.fn(),
      isInReportingChain: jest.fn(async () => false),
      changeStatus: jest.fn(),
    };
    notifications = { notify: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LeaveRequestsService,
        { provide: getRepositoryToken(LeaveRequest), useValue: requests },
        { provide: LeavePolicyService, useValue: policy },
        { provide: EmployeesService, useValue: employees },
        { provide: NotificationsService, useValue: notifications },
        { provide: Logger, useValue: { warn: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(LeaveRequestsService);
  });

  describe('submit', () => {
    const dto = {
      leaveTypeId: 't1',
      startDate: '2026-12-21',
      endDate: '2026-12-23',
    };

    it('reserves pending days, resolves the manager as approver and notifies them', async () => {
      requests.findOne
        .mockResolvedValueOnce(null)
        .mockImplementation(async () =>
          Object.assign(requests.save.mock.calls[0][0], {
            employee,
            leaveType: annual,
          }),
        );

      await service.submit('e1', dto, 'u-emp');

      expect(policy.applyToBalance).toHaveBeenCalledWith(
        expect.any(LeaveBalance),
        { pending: 3 },
      );
      const saved = requests.save.mock.calls[0][0] as LeaveRequest;
      expect(saved).toMatchObject({
        days: 3,
        year: 2026,
        status: LeaveRequestStatus.PENDING,
        approverUserId: 'u-mgr',
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'LEAVE_REQUESTED',
          to: { userId: 'u-mgr' },
        }),
      );
    });

    it('rejects insufficient balance without reserving', async () => {
      policy.ensureBalance.mockResolvedValue(
        Object.assign(balance(), { used: 18 }),
      );
      await expect(service.submit('e1', dto, 'u-emp')).rejects.toThrow(
        /Insufficient Annual balance: 2 day/,
      );
      expect(policy.applyToBalance).not.toHaveBeenCalled();
    });

    it('rejects overlapping, cross-year, half-day-on-range and no-working-day requests', async () => {
      requests.findOne.mockResolvedValueOnce({
        status: LeaveRequestStatus.APPROVED,
      });
      await expect(service.submit('e1', dto, 'u-emp')).rejects.toThrow(
        ConflictException,
      );

      await expect(
        service.submit('e1', { ...dto, endDate: '2027-01-02' }, 'u-emp'),
      ).rejects.toThrow(/one calendar year/);

      policy.countWorkingDays.mockResolvedValueOnce(0);
      await expect(service.submit('e1', dto, 'u-emp')).rejects.toThrow(
        /no working days/,
      );
    });

    it('unpaid leave skips balances entirely', async () => {
      policy.findType.mockResolvedValue({ ...annual, requiresBalance: false });
      requests.findOne
        .mockResolvedValueOnce(null)
        .mockImplementation(async () =>
          Object.assign(requests.save.mock.calls[0][0], {
            employee,
            leaveType: annual,
          }),
        );
      await service.submit('e1', { ...dto, halfDay: HalfDay.NONE }, 'u-emp');
      expect(policy.ensureBalance).not.toHaveBeenCalled();
    });
  });

  describe('approve / reject / cancel', () => {
    const pending = (o: Partial<LeaveRequest> = {}) =>
      Object.assign(new LeaveRequest(), {
        id: 'r1',
        employeeId: 'e1',
        leaveTypeId: 't1',
        days: 3,
        year: 2026,
        status: LeaveRequestStatus.PENDING,
        startDate: addDays(todayIso(), 10),
        endDate: addDays(todayIso(), 12),
        approverUserId: 'u-mgr',
        statusApplied: false,
        employee,
        leaveType: annual,
        ...o,
      });

    it('approve by the designated manager moves pending → used and notifies the employee', async () => {
      requests.findOne.mockResolvedValue(pending());
      await service.approve('r1', actor(), 'enjoy');
      expect(policy.applyToBalance).toHaveBeenCalledWith(
        expect.any(LeaveBalance),
        { pending: -3, used: 3 },
      );
      expect(requests.update).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({
          status: LeaveRequestStatus.APPROVED,
          decidedByUserId: 'u-mgr',
          decisionNote: 'enjoy',
        }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'LEAVE_DECIDED',
          to: { userId: 'u-emp' },
          data: expect.objectContaining({ decision: 'approved' }),
        }),
      );
      expect(employees.changeStatus).not.toHaveBeenCalled(); // short leave
    });

    it('a stranger cannot approve; HR can; nobody approves their own', async () => {
      requests.findOne.mockResolvedValue(pending());
      await expect(
        service.approve('r1', actor({ id: 'u-other' })),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.approve(
          'r1',
          actor({
            id: 'u-hr',
            permissions: [
              PERMISSIONS.LEAVE_APPROVE,
              PERMISSIONS.LEAVE_READ_ALL,
            ],
          }),
        ),
      ).resolves.toBeDefined();
      await expect(
        service.approve(
          'r1',
          actor({ id: 'u-emp', permissions: [PERMISSIONS.LEAVE_READ_ALL] }),
        ),
      ).rejects.toThrow(/own request/);
    });

    it('a manager higher in the chain can approve too', async () => {
      requests.findOne.mockResolvedValue(pending());
      employees.findByUserId.mockResolvedValue({ id: 'e-director' });
      employees.isInReportingChain.mockResolvedValue(true);
      await expect(
        service.approve('r1', actor({ id: 'u-director' })),
      ).resolves.toBeDefined();
    });

    it('approving a long leave that has already started flips the employee to ON_LEAVE', async () => {
      requests.findOne.mockResolvedValue(
        pending({
          startDate: addDays(todayIso(), -1),
          endDate: addDays(todayIso(), 40),
          days: 28,
        }),
      );
      await service.approve('r1', actor());
      expect(employees.changeStatus).toHaveBeenCalledWith(
        'e1',
        expect.objectContaining({ status: EmployeeStatus.ON_LEAVE }),
        'u-mgr',
      );
      expect(requests.update).toHaveBeenCalledWith('r1', {
        statusApplied: true,
      });
    });

    it('reject releases the reservation', async () => {
      requests.findOne.mockResolvedValue(pending());
      await service.reject('r1', actor(), 'no cover');
      expect(policy.applyToBalance).toHaveBeenCalledWith(
        expect.any(LeaveBalance),
        { pending: -3 },
      );
      expect(requests.update).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({ status: LeaveRequestStatus.REJECTED }),
      );
    });

    it('employee cancels own approved future leave: used days returned, approver told', async () => {
      requests.findOne.mockResolvedValue(
        pending({ status: LeaveRequestStatus.APPROVED }),
      );
      await service.cancel('r1', actor({ id: 'u-emp', permissions: [] }));
      expect(policy.applyToBalance).toHaveBeenCalledWith(
        expect.any(LeaveBalance),
        { used: -3 },
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'LEAVE_CANCELLED',
          to: { userId: 'u-mgr' },
        }),
      );
    });

    it('employee cannot cancel approved leave that already started; HR can', async () => {
      requests.findOne.mockResolvedValue(
        pending({
          status: LeaveRequestStatus.APPROVED,
          startDate: addDays(todayIso(), -1),
          endDate: addDays(todayIso(), 1),
        }),
      );
      await expect(
        service.cancel('r1', actor({ id: 'u-emp', permissions: [] })),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.cancel(
          'r1',
          actor({ id: 'u-hr', permissions: [PERMISSIONS.LEAVE_READ_ALL] }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('syncEmployeeStatuses', () => {
    it('starts long leave today and ends leave that finished yesterday', async () => {
      const today = todayIso();
      requests.find
        .mockResolvedValueOnce([
          Object.assign(new LeaveRequest(), {
            id: 'long',
            employeeId: 'e1',
            startDate: today,
            endDate: addDays(today, 35),
            employee: { status: EmployeeStatus.ACTIVE },
          }),
          Object.assign(new LeaveRequest(), {
            id: 'short',
            employeeId: 'e2',
            startDate: today,
            endDate: addDays(today, 2),
            employee: { status: EmployeeStatus.ACTIVE },
          }),
        ])
        .mockResolvedValueOnce([
          Object.assign(new LeaveRequest(), {
            id: 'over',
            employeeId: 'e3',
            startDate: addDays(today, -40),
            endDate: addDays(today, -1),
            employee: {},
          }),
        ]);
      employees.findById.mockResolvedValue({ status: EmployeeStatus.ON_LEAVE });

      const result = await service.syncEmployeeStatuses(today);

      expect(result).toEqual({ started: 1, ended: 1 });
      expect(employees.changeStatus).toHaveBeenCalledWith(
        'e1',
        expect.objectContaining({ status: EmployeeStatus.ON_LEAVE }),
        null,
      );
      expect(employees.changeStatus).toHaveBeenCalledWith(
        'e3',
        expect.objectContaining({ status: EmployeeStatus.ACTIVE }),
        null,
      );
      expect(requests.update).toHaveBeenCalledWith('over', {
        statusApplied: false,
      });
    });
  });
});
