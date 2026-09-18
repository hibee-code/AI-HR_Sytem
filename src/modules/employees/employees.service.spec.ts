import { BadRequestException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService } from '../auth/auth.service';
import { RbacService } from '../rbac/rbac.service';
import { UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { Department } from './entities/department.entity';
import {
  Employee,
  EmployeeStatus,
  EmploymentType,
} from './entities/employee.entity';
import {
  EmploymentChangeType,
  EmploymentHistory,
} from './entities/employment-history.entity';
import { Position } from './entities/position.entity';
import { EMPLOYEE_EVENTS } from './employees.events';
import { EmployeesService } from './employees.service';

type Mock = jest.Mock;

function employee(overrides: Partial<Employee> = {}): Employee {
  return Object.assign(new Employee(), {
    id: 'e1',
    userId: null,
    employeeNumber: 'EMP-0001',
    firstName: 'Jane',
    lastName: 'Doe',
    workEmail: 'jane@co.com',
    hireDate: '2026-01-01',
    terminationDate: null,
    status: EmployeeStatus.ACTIVE,
    employmentType: EmploymentType.FULL_TIME,
    departmentId: 'd1',
    positionId: null,
    managerId: 'boss',
    ...overrides,
  });
}

describe('EmployeesService', () => {
  let service: EmployeesService;
  let employees: {
    findOne: Mock;
    find: Mock;
    exists: Mock;
    update: Mock;
    query: Mock;
    manager: { transaction: Mock };
  };
  let departments: Record<string, Mock>;
  let positions: Record<string, Mock>;
  let users: Record<string, Mock>;
  let auth: Record<string, Mock>;
  let rbac: Record<string, Mock>;
  let events: { emit: Mock };
  let em: Record<string, Mock>;

  beforeEach(async () => {
    em = {
      query: jest.fn(async () => [{ nextval: '7' }]),
      create: jest.fn((_cls, v) => v),
      save: jest.fn(async (_cls, v) => ({ id: 'saved-id', ...v })),
      update: jest.fn(),
    };
    employees = {
      findOne: jest.fn(),
      find: jest.fn(),
      exists: jest.fn(async () => false),
      update: jest.fn(),
      query: jest.fn(async () => []),
      manager: {
        transaction: jest.fn(async (cb: (e: typeof em) => unknown) => cb(em)),
      },
    };
    departments = { exists: jest.fn(async () => true) };
    positions = { findOne: jest.fn() };
    users = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      setStatus: jest.fn(),
    };
    auth = {
      invite: jest.fn(async () => ({ id: 'new-user' })),
      logoutAll: jest.fn(),
    };
    rbac = { findRolesByNames: jest.fn(async () => []) };
    events = { emit: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: getRepositoryToken(Employee), useValue: employees },
        { provide: getRepositoryToken(EmploymentHistory), useValue: {} },
        { provide: getRepositoryToken(Department), useValue: departments },
        { provide: getRepositoryToken(Position), useValue: positions },
        { provide: UsersService, useValue: users },
        { provide: AuthService, useValue: auth },
        { provide: RbacService, useValue: rbac },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = moduleRef.get(EmployeesService);
  });

  describe('create', () => {
    const dto = {
      firstName: 'New',
      lastName: 'Hire',
      workEmail: 'new@co.com',
      hireDate: '2026-10-01',
      departmentId: 'd1',
    };

    it('generates EMP-#### from the sequence, writes a HIRE history row and emits', async () => {
      employees.findOne.mockResolvedValue(employee({ id: 'saved-id' }));

      await service.create(dto, 'actor');

      const savedEmployee = em.save.mock.calls[0][1];
      expect(savedEmployee.employeeNumber).toBe('EMP-0007');
      expect(savedEmployee.status).toBe(EmployeeStatus.ONBOARDING);

      const history = em.save.mock.calls[1][1];
      expect(history).toMatchObject({
        changeType: EmploymentChangeType.HIRE,
        toDepartmentId: 'd1',
        toStatus: EmployeeStatus.ONBOARDING,
        changedByUserId: 'actor',
      });
      expect(events.emit).toHaveBeenCalledWith(
        EMPLOYEE_EVENTS.CREATED,
        expect.anything(),
      );
    });

    it('rejects a duplicate work email', async () => {
      employees.exists.mockResolvedValueOnce(true);
      await expect(service.create(dto, 'actor')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects a position scoped to another department', async () => {
      positions.findOne.mockResolvedValue({
        id: 'p1',
        isActive: true,
        departmentId: 'other',
      });
      await expect(
        service.create({ ...dto, positionId: 'p1' }, 'actor'),
      ).rejects.toThrow(/different department/);
    });

    it('with inviteLogin: invites at the work email and links the new user', async () => {
      users.findByEmail.mockResolvedValue(null);
      employees.findOne.mockResolvedValue(
        employee({ id: 'saved-id', userId: 'new-user' }),
      );

      await service.create(
        { ...dto, inviteLogin: { roles: ['EMPLOYEE'] } },
        'actor',
      );

      expect(rbac.findRolesByNames).toHaveBeenCalledWith(['EMPLOYEE']);
      expect(auth.invite).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@co.com', roles: ['EMPLOYEE'] }),
      );
      expect(employees.update).toHaveBeenCalledWith('saved-id', {
        userId: 'new-user',
      });
    });

    it('refuses inviteLogin when a login with that email already exists', async () => {
      users.findByEmail.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create(
          { ...dto, inviteLogin: { roles: ['EMPLOYEE'] } },
          'actor',
        ),
      ).rejects.toThrow(/already exists/);
      expect(em.save).not.toHaveBeenCalled();
    });
  });

  describe('changeAssignment', () => {
    it('records only the dimensions that changed', async () => {
      employees.findOne.mockResolvedValue(employee());
      departments.exists.mockResolvedValue(true);
      positions.findOne.mockResolvedValue({
        id: 'p2',
        isActive: true,
        departmentId: null,
      });

      await service.changeAssignment(
        'e1',
        {
          changeType: EmploymentChangeType.PROMOTION,
          effectiveDate: '2026-11-01',
          positionId: 'p2',
        },
        'actor',
      );

      expect(em.update).toHaveBeenCalledWith(Employee, 'e1', {
        departmentId: 'd1',
        positionId: 'p2',
        managerId: 'boss',
      });
      const history = em.save.mock.calls[0][1];
      expect(history).toMatchObject({
        fromPositionId: null,
        toPositionId: 'p2',
      });
      expect(history.fromDepartmentId).toBeNull();
      expect(history.toDepartmentId).toBeNull();
      expect(history.toManagerId).toBeNull();
    });

    it('rejects a no-op change', async () => {
      employees.findOne.mockResolvedValue(employee());
      await expect(
        service.changeAssignment(
          'e1',
          {
            changeType: EmploymentChangeType.TRANSFER,
            effectiveDate: '2026-11-01',
            departmentId: 'd1',
          },
          'actor',
        ),
      ).rejects.toThrow(/Nothing changes/);
    });

    it('rejects self-management and reporting cycles', async () => {
      employees.findOne.mockResolvedValue(employee());
      await expect(
        service.changeAssignment(
          'e1',
          {
            changeType: EmploymentChangeType.MANAGER_CHANGE,
            effectiveDate: '2026-11-01',
            managerId: 'e1',
          },
          'actor',
        ),
      ).rejects.toThrow(/manage themselves/);

      employees.exists.mockResolvedValue(true);
      employees.query.mockResolvedValue([{ found: 1 }]); // candidate manager reports to e1
      await expect(
        service.changeAssignment(
          'e1',
          {
            changeType: EmploymentChangeType.MANAGER_CHANGE,
            effectiveDate: '2026-11-01',
            managerId: 'report',
          },
          'actor',
        ),
      ).rejects.toThrow(/reporting cycle/);
    });
  });

  describe('changeStatus', () => {
    it.each([
      [EmployeeStatus.ONBOARDING, EmployeeStatus.ACTIVE, true],
      [EmployeeStatus.ACTIVE, EmployeeStatus.ON_LEAVE, true],
      [EmployeeStatus.ON_LEAVE, EmployeeStatus.ACTIVE, true],
      [EmployeeStatus.ONBOARDING, EmployeeStatus.ON_LEAVE, false],
      [EmployeeStatus.TERMINATED, EmployeeStatus.ACTIVE, false],
    ])('%s → %s allowed=%s', async (from, to, allowed) => {
      employees.findOne.mockResolvedValue(employee({ status: from }));
      const call = service.changeStatus(
        'e1',
        { status: to as never, effectiveDate: '2026-11-01' },
        'actor',
      );
      if (allowed) {
        await expect(call).resolves.toBeDefined();
        expect(em.update).toHaveBeenCalledWith(Employee, 'e1', { status: to });
      } else {
        await expect(call).rejects.toThrow(BadRequestException);
      }
    });
  });

  describe('terminate', () => {
    it('moves reports up, clears headship, suspends the login, emits', async () => {
      employees.findOne.mockResolvedValue(
        employee({ userId: 'u1', managerId: 'boss' }),
      );
      users.findById.mockResolvedValue({ id: 'u1', status: UserStatus.ACTIVE });

      await service.terminate(
        'e1',
        { terminationDate: '2026-12-31', reason: 'resigned' },
        'actor',
      );

      expect(em.update).toHaveBeenCalledWith(Employee, 'e1', {
        status: EmployeeStatus.TERMINATED,
        terminationDate: '2026-12-31',
      });
      expect(em.update).toHaveBeenCalledWith(
        Employee,
        { managerId: 'e1' },
        { managerId: 'boss' },
      );
      expect(em.update).toHaveBeenCalledWith(
        Department,
        { headEmployeeId: 'e1' },
        { headEmployeeId: null },
      );
      expect(users.setStatus).toHaveBeenCalledWith(
        'u1',
        UserStatus.SUSPENDED,
        'actor',
      );
      expect(auth.logoutAll).toHaveBeenCalledWith('u1');
      expect(events.emit).toHaveBeenCalledWith(
        EMPLOYEE_EVENTS.TERMINATED,
        expect.anything(),
      );
    });

    it('can keep the login active when asked', async () => {
      employees.findOne.mockResolvedValue(employee({ userId: 'u1' }));
      await service.terminate(
        'e1',
        { terminationDate: '2026-12-31', suspendLogin: false },
        'actor',
      );
      expect(users.setStatus).not.toHaveBeenCalled();
    });

    it('rejects a termination date before the hire date, and double termination', async () => {
      employees.findOne.mockResolvedValue(employee({ hireDate: '2026-06-01' }));
      await expect(
        service.terminate('e1', { terminationDate: '2026-01-01' }, 'actor'),
      ).rejects.toThrow(/precede the hire date/);
      employees.findOne.mockResolvedValue(
        employee({ status: EmployeeStatus.TERMINATED }),
      );
      await expect(
        service.terminate('e1', { terminationDate: '2027-01-01' }, 'actor'),
      ).rejects.toThrow(/is terminated/);
    });
  });

  describe('orgChart', () => {
    it('nests rows by manager_id', async () => {
      employees.query.mockResolvedValue([
        {
          id: 'ceo',
          manager_id: null,
          employee_number: '1',
          first_name: 'A',
          last_name: 'A',
          photo_url: null,
          position: 'CEO',
          department: 'Exec',
        },
        {
          id: 'vp',
          manager_id: 'ceo',
          employee_number: '2',
          first_name: 'B',
          last_name: 'B',
          photo_url: null,
          position: 'VP',
          department: 'Eng',
        },
        {
          id: 'eng',
          manager_id: 'vp',
          employee_number: '3',
          first_name: 'C',
          last_name: 'C',
          photo_url: null,
          position: null,
          department: 'Eng',
        },
      ]);
      const chart = await service.orgChart();
      expect(chart).toHaveLength(1);
      expect(chart[0].id).toBe('ceo');
      expect(chart[0].children[0].id).toBe('vp');
      expect(chart[0].children[0].children[0]).toMatchObject({
        id: 'eng',
        position: null,
      });
    });
  });
});
