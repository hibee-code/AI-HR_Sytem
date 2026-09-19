import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { ChecklistTemplatesService } from './checklist-templates.service';
import { ChecklistTask, TaskStatus } from './entities/checklist-task.entity';
import {
  AssigneeRule,
  ChecklistType,
} from './entities/checklist-template.entity';
import { Checklist, ChecklistStatus } from './entities/checklist.entity';
import {
  ONBOARDING_EVENTS,
  OnboardingService,
  progressOf,
} from './onboarding.service';

const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u-actor',
  email: 'a@b.c',
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [],
  passwordChangedAt: null,
  ...over,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const task = (over: Record<string, any> = {}): ChecklistTask =>
  Object.assign(new ChecklistTask(), {
    id: 't1',
    checklistId: 'c1',
    title: 'Task',
    status: TaskStatus.PENDING,
    isRequired: true,
    dueDate: todayIso(),
    assigneeUserId: null,
    assigneeRoleName: null,
    ...over,
  });

describe('progressOf', () => {
  it('counts done, required-done and overdue', () => {
    const p = progressOf([
      task({ status: TaskStatus.DONE }),
      task({ status: TaskStatus.SKIPPED, isRequired: false }),
      task({ status: TaskStatus.PENDING, dueDate: addDays(todayIso(), -2) }),
      task({ status: TaskStatus.IN_PROGRESS, dueDate: addDays(todayIso(), 2) }),
    ]);
    expect(p).toEqual({
      total: 4,
      done: 2,
      required: 3,
      requiredDone: 1,
      overdue: 1,
      percent: 50,
    });
  });
});

describe('OnboardingService', () => {
  let service: OnboardingService;
  let checklists: Record<string, jest.Mock>;
  let tasks: Record<string, jest.Mock>;
  let templates: Record<string, jest.Mock>;
  let employees: Record<string, jest.Mock>;
  let notifications: { notify: jest.Mock };
  let events: { emit: jest.Mock };

  const employee = {
    id: 'e1',
    userId: 'u-emp',
    hireDate: '2026-10-01',
    terminationDate: null,
    departmentId: 'd1',
    status: EmployeeStatus.ONBOARDING,
    manager: { userId: 'u-mgr' },
    fullName: 'Jane Doe',
  };
  const template = {
    id: 'tpl',
    type: ChecklistType.ONBOARDING,
    items: [
      {
        id: 'i1',
        title: 'Contract',
        assigneeRule: AssigneeRule.EMPLOYEE,
        assigneeRoleName: null,
        dueOffsetDays: -3,
        sortOrder: 0,
        isRequired: true,
        description: null,
      },
      {
        id: 'i2',
        title: 'Laptop',
        assigneeRule: AssigneeRule.HR,
        assigneeRoleName: 'HR_MANAGER',
        dueOffsetDays: -1,
        sortOrder: 1,
        isRequired: true,
        description: null,
      },
      {
        id: 'i3',
        title: '30-day plan',
        assigneeRule: AssigneeRule.MANAGER,
        assigneeRoleName: null,
        dueOffsetDays: 0,
        sortOrder: 2,
        isRequired: false,
        description: null,
      },
    ],
  };

  beforeEach(async () => {
    checklists = {
      findOne: jest.fn(),
      create: jest.fn((v) => Object.assign(new Checklist(), v)),
      save: jest.fn(async (c) => Object.assign(c, { id: 'c1' })),
      update: jest.fn(),
    };
    tasks = {
      create: jest.fn((v) => Object.assign(new ChecklistTask(), v)),
      findOne: jest.fn(),
      find: jest.fn(async () => []),
      save: jest.fn(async (t) => t),
      update: jest.fn(),
    };
    templates = {
      findById: jest.fn(),
      resolveFor: jest.fn(async () => template),
    };
    employees = {
      findById: jest.fn(async () => employee),
      findByUserId: jest.fn(),
      isInReportingChain: jest.fn(async () => false),
      changeStatus: jest.fn(),
    };
    notifications = { notify: jest.fn() };
    events = { emit: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: getRepositoryToken(Checklist), useValue: checklists },
        { provide: getRepositoryToken(ChecklistTask), useValue: tasks },
        { provide: ChecklistTemplatesService, useValue: templates },
        { provide: EmployeesService, useValue: employees },
        { provide: NotificationsService, useValue: notifications },
        { provide: EventEmitter2, useValue: events },
        { provide: Logger, useValue: { warn: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(OnboardingService);
    // findById after save: return what was saved
    checklists.findOne.mockImplementation(async ({ where }) =>
      where.status ? null : (checklists.save.mock.calls[0]?.[0] ?? null),
    );
  });

  describe('start', () => {
    it('copies template items into tasks with due dates relative to the anchor and resolved assignees', async () => {
      const c = await service.start('e1', ChecklistType.ONBOARDING, {
        actorUserId: 'hr',
      });

      const saved = checklists.save.mock.calls[0][0] as Checklist;
      expect(saved.anchorDate).toBe('2026-10-01');
      expect(
        saved.tasks.map((t) => [
          t.title,
          t.dueDate,
          t.assigneeUserId,
          t.assigneeRoleName,
        ]),
      ).toEqual([
        ['Contract', '2026-09-28', 'u-emp', null],
        ['Laptop', '2026-09-30', null, 'HR_MANAGER'],
        ['30-day plan', '2026-10-01', 'u-mgr', null],
      ]);
      expect(
        (c as { progress: { total: number } } | null)?.progress.total,
      ).toBe(3);
      expect(events.emit).toHaveBeenCalledWith(
        ONBOARDING_EVENTS.CHECKLIST_STARTED,
        expect.anything(),
      );
    });

    it('refuses a second in-progress checklist of the same type', async () => {
      checklists.findOne.mockResolvedValueOnce({ id: 'existing' });
      await expect(
        service.start('e1', ChecklistType.ONBOARDING),
      ).rejects.toThrow(ConflictException);
    });

    it('returns null when no template matches', async () => {
      templates.resolveFor.mockResolvedValue(null);
      await expect(
        service.start('e1', ChecklistType.OFFBOARDING),
      ).resolves.toBeNull();
      expect(checklists.save).not.toHaveBeenCalled();
    });

    it('rejects an explicit template of the wrong type', async () => {
      templates.findById.mockResolvedValue({
        ...template,
        type: ChecklistType.OFFBOARDING,
      });
      await expect(
        service.start('e1', ChecklistType.ONBOARDING, { templateId: 'tpl' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateTask', () => {
    const inProgress = (over: Partial<ChecklistTask> = {}) =>
      task({
        checklist: {
          id: 'c1',
          status: ChecklistStatus.IN_PROGRESS,
        } as Checklist,
        ...over,
      });

    it('assignee can complete; sets completedAt/by', async () => {
      const t = inProgress({ assigneeUserId: 'u-actor' });
      tasks.findOne.mockResolvedValue(t);
      checklists.findOne.mockResolvedValue({
        id: 'c1',
        status: ChecklistStatus.IN_PROGRESS,
        tasks: [t, task({ id: 't2' })],
        employeeId: 'e1',
      });

      await service.updateTask(
        't1',
        { status: TaskStatus.DONE, notes: 'signed' },
        user(),
      );

      expect(tasks.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TaskStatus.DONE,
          notes: 'signed',
          completedByUserId: 'u-actor',
        }),
      );
      expect(checklists.update).not.toHaveBeenCalled(); // t2 still open
    });

    it('role holder can act on role-based tasks; strangers cannot', async () => {
      tasks.findOne.mockResolvedValue(
        inProgress({ assigneeRoleName: 'HR_MANAGER' }),
      );
      checklists.findOne.mockResolvedValue({
        id: 'c1',
        status: ChecklistStatus.IN_PROGRESS,
        tasks: [task()],
        employeeId: 'e1',
      });
      await expect(
        service.updateTask(
          't1',
          { status: TaskStatus.IN_PROGRESS },
          user({ roles: ['HR_MANAGER'] }),
        ),
      ).resolves.toBeDefined();
      await expect(
        service.updateTask(
          't1',
          { status: TaskStatus.IN_PROGRESS },
          user({ roles: ['EMPLOYEE'] }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('completing the last required task completes the checklist and activates the employee', async () => {
      const t = inProgress({ assigneeUserId: 'u-actor' });
      tasks.findOne.mockResolvedValue(t);
      checklists.findOne.mockResolvedValue({
        id: 'c1',
        status: ChecklistStatus.IN_PROGRESS,
        type: ChecklistType.ONBOARDING,
        employeeId: 'e1',
        createdByUserId: 'hr',
        tasks: [
          t,
          task({ id: 't2', status: TaskStatus.PENDING, isRequired: false }),
        ],
      });

      await service.updateTask(
        't1',
        { status: TaskStatus.DONE },
        user({ permissions: [PERMISSIONS.ONBOARDING_MANAGE] }),
      );

      expect(checklists.update).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ status: ChecklistStatus.COMPLETED }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        ONBOARDING_EVENTS.CHECKLIST_COMPLETED,
        expect.objectContaining({ employeeId: 'e1' }),
      );
      expect(employees.changeStatus).toHaveBeenCalledWith(
        'e1',
        expect.objectContaining({ status: EmployeeStatus.ACTIVE }),
        null,
      );
    });

    it('does not touch employees who are already ACTIVE (manual flip earlier)', async () => {
      employees.findById.mockResolvedValue({
        ...employee,
        status: EmployeeStatus.ACTIVE,
      });
      const t = inProgress({ assigneeUserId: 'u-actor' });
      tasks.findOne.mockResolvedValue(t);
      checklists.findOne.mockResolvedValue({
        id: 'c1',
        status: ChecklistStatus.IN_PROGRESS,
        type: ChecklistType.ONBOARDING,
        employeeId: 'e1',
        tasks: [t],
      });
      await service.updateTask('t1', { status: TaskStatus.SKIPPED }, user());
      expect(employees.changeStatus).not.toHaveBeenCalled();
    });

    it('rejects updates on a completed checklist', async () => {
      tasks.findOne.mockResolvedValue(
        task({
          assigneeUserId: 'u-actor',
          checklist: { status: ChecklistStatus.COMPLETED } as Checklist,
        }),
      );
      await expect(
        service.updateTask('t1', { status: TaskStatus.DONE }, user()),
      ).rejects.toThrow(/no longer in progress/);
    });
  });

  describe('sendReminders', () => {
    it('sends one digest per user, skips tasks reminded today, and stamps lastRemindedAt', async () => {
      const today = todayIso();
      const emp = { fullName: 'Jane Doe' };
      tasks.find.mockResolvedValue([
        task({
          id: 'a',
          title: 'Contract',
          dueDate: addDays(today, -2),
          assigneeUserId: 'u1',
          assignee: { firstName: 'Ann' },
          checklist: { employee: emp },
        }),
        task({
          id: 'b',
          title: 'Laptop',
          dueDate: today,
          assigneeUserId: 'u1',
          assignee: { firstName: 'Ann' },
          checklist: { employee: emp },
        }),
        task({
          id: 'c',
          title: 'Plan',
          dueDate: addDays(today, 1),
          assigneeUserId: 'u2',
          assignee: { firstName: 'Bob' },
          checklist: { employee: emp },
        }),
        task({
          id: 'd',
          title: 'Already',
          dueDate: today,
          assigneeUserId: 'u2',
          lastRemindedAt: new Date(),
          checklist: { employee: emp },
        }),
        task({
          id: 'e',
          title: 'Role only',
          dueDate: today,
          assigneeRoleName: 'HR_MANAGER',
          checklist: { employee: emp },
        }),
      ] as never);

      const digests = await service.sendReminders(1);

      expect(digests).toBe(2);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'TASKS_DUE',
          to: { userId: 'u1' },
          dedupeKey: `tasks-due:u1:${today}`,
          data: expect.objectContaining({
            firstName: 'Ann',
            taskCount: 2,
            overdueCount: 1,
            taskSummary: expect.stringContaining('OVERDUE by 2d'),
          }),
        }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          to: { userId: 'u2' },
          data: expect.objectContaining({ taskCount: 1 }),
        }),
      );
      expect(tasks.update).toHaveBeenCalledTimes(2);
    });
  });
});
