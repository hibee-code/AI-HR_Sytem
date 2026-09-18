import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { addDays, daysBetween, todayIso } from '../../common/utils/date';
import { EmployeeStatus } from '../employees/entities/employee.entity';
import { EmployeesService } from '../employees/employees.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { ChecklistTemplatesService } from './checklist-templates.service';
import {
  ListChecklistsQueryDto,
  ReassignTaskDto,
  UpdateTaskDto,
} from './dto/onboarding.dto';
import {
  ChecklistTask,
  OPEN_TASK_STATUSES,
  TaskStatus,
} from './entities/checklist-task.entity';
import {
  AssigneeRule,
  ChecklistType,
} from './entities/checklist-template.entity';
import { Checklist, ChecklistStatus } from './entities/checklist.entity';

export const ONBOARDING_EVENTS = {
  CHECKLIST_STARTED: 'onboarding.checklist.started',
  CHECKLIST_COMPLETED: 'onboarding.checklist.completed',
} as const;

export class ChecklistCompletedEvent {
  constructor(
    public readonly checklistId: string,
    public readonly employeeId: string,
    public readonly type: ChecklistType,
  ) {}
}

export interface ChecklistProgress {
  total: number;
  done: number;
  required: number;
  requiredDone: number;
  overdue: number;
  percent: number;
}

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(Checklist)
    private readonly checklists: Repository<Checklist>,
    @InjectRepository(ChecklistTask)
    private readonly tasks: Repository<ChecklistTask>,
    private readonly templates: ChecklistTemplatesService,
    private readonly employees: EmployeesService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
    private readonly logger: Logger,
  ) {}

  // ── Start / read ──────────────────────────────────────────────────────

  /**
   * Instantiates a checklist for an employee. Picks the best template unless
   * one is given; returns null (and logs) when no template exists so event
   * listeners don't fail. Only one in-progress checklist per type per employee.
   */
  async start(
    employeeId: string,
    type: ChecklistType,
    opts: {
      templateId?: string;
      anchorDate?: string;
      actorUserId?: string;
    } = {},
  ): Promise<Checklist | null> {
    const emp = await this.employees.findById(employeeId);

    const existing = await this.checklists.findOne({
      where: { employeeId, type, status: ChecklistStatus.IN_PROGRESS },
    });
    if (existing)
      throw new ConflictException(
        `Employee already has an in-progress ${type} checklist`,
      );

    const template = opts.templateId
      ? await this.templates.findById(opts.templateId)
      : await this.templates.resolveFor(type, emp.departmentId);
    if (!template) {
      this.logger.warn(
        { employeeId, type },
        'no checklist template configured; nothing started',
      );
      return null;
    }
    if (template.type !== type)
      throw new BadRequestException(
        `Template is for ${template.type}, not ${type}`,
      );

    const anchorDate =
      opts.anchorDate ??
      (type === ChecklistType.ONBOARDING
        ? emp.hireDate
        : (emp.terminationDate ?? todayIso()));

    const checklist = this.checklists.create({
      employeeId,
      templateId: template.id,
      type,
      status: ChecklistStatus.IN_PROGRESS,
      anchorDate,
      completedAt: null,
      createdByUserId: opts.actorUserId ?? null,
      tasks: template.items.map((item) =>
        this.tasks.create({
          templateItemId: item.id,
          title: item.title,
          description: item.description,
          assigneeRule: item.assigneeRule,
          assigneeUserId: this.resolveAssignee(item.assigneeRule, emp),
          assigneeRoleName: item.assigneeRoleName,
          dueDate: addDays(anchorDate, item.dueOffsetDays),
          status: TaskStatus.PENDING,
          isRequired: item.isRequired,
          sortOrder: item.sortOrder,
          notes: null,
          documentId: null,
          completedAt: null,
          completedByUserId: null,
          lastRemindedAt: null,
        }),
      ),
    });
    const saved = await this.checklists.save(checklist);

    if (saved.tasks.length === 0) await this.complete(saved);
    this.events.emit(ONBOARDING_EVENTS.CHECKLIST_STARTED, {
      checklistId: saved.id,
      employeeId,
      type,
    });
    return this.findById(saved.id);
  }

  async findById(
    id: string,
  ): Promise<Checklist & { progress: ChecklistProgress }> {
    const checklist = await this.checklists.findOne({
      where: { id },
      relations: { tasks: { assignee: true }, employee: true, template: true },
      order: { tasks: { sortOrder: 'ASC', dueDate: 'ASC' } },
    });
    if (!checklist) throw new NotFoundException('Checklist not found');
    return Object.assign(checklist, { progress: progressOf(checklist.tasks) });
  }

  async list(
    query: ListChecklistsQueryDto,
  ): Promise<PaginatedResponse<Checklist>> {
    const [data, total] = await this.checklists.findAndCount({
      where: {
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      relations: { employee: true },
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return new PaginatedResponse(data, total, query);
  }

  forEmployee(employeeId: string): Promise<Checklist[]> {
    return this.checklists.find({
      where: { employeeId },
      relations: { tasks: true },
      order: { createdAt: 'DESC', tasks: { sortOrder: 'ASC' } },
    });
  }

  /** Open tasks assigned to this login directly or via one of their roles. */
  async myTasks(actor: AuthUser): Promise<ChecklistTask[]> {
    const qb = this.tasks
      .createQueryBuilder('t')
      .innerJoinAndSelect('t.checklist', 'c')
      .innerJoinAndSelect('c.employee', 'e')
      .where('c.status = :inProgress', {
        inProgress: ChecklistStatus.IN_PROGRESS,
      })
      .andWhere('t.status IN (:...open)', { open: OPEN_TASK_STATUSES })
      .andWhere(
        '(t.assigneeUserId = :uid OR t.assigneeRoleName IN (:...roles))',
        {
          uid: actor.id,
          roles: actor.roles.length ? actor.roles : ['__none__'],
        },
      )
      .orderBy('t.dueDate', 'ASC')
      .addOrderBy('t.sortOrder', 'ASC');
    return qb.getMany();
  }

  // ── Task lifecycle ────────────────────────────────────────────────────

  async updateTask(
    taskId: string,
    dto: UpdateTaskDto,
    actor: AuthUser,
  ): Promise<Checklist> {
    const task = await this.loadTask(taskId);
    if (!this.canActOn(task, actor))
      throw new ForbiddenException('Not your task');
    if (task.checklist.status !== ChecklistStatus.IN_PROGRESS) {
      throw new BadRequestException('Checklist is no longer in progress');
    }

    if (dto.notes !== undefined) task.notes = dto.notes;
    if (dto.documentId !== undefined) task.documentId = dto.documentId;
    if (dto.status !== undefined && dto.status !== task.status) {
      task.status = dto.status;
      const closed =
        dto.status === TaskStatus.DONE || dto.status === TaskStatus.SKIPPED;
      task.completedAt = closed ? new Date() : null;
      task.completedByUserId = closed ? actor.id : null;
    }
    await this.tasks.save(task);

    await this.completeIfFinished(task.checklistId);
    return this.findById(task.checklistId);
  }

  async reassignTask(taskId: string, dto: ReassignTaskDto): Promise<Checklist> {
    const task = await this.loadTask(taskId);
    if (dto.assigneeUserId !== undefined)
      task.assigneeUserId = dto.assigneeUserId;
    if (dto.assigneeRoleName !== undefined)
      task.assigneeRoleName = dto.assigneeRoleName;
    if (!task.assigneeUserId && !task.assigneeRoleName) {
      throw new BadRequestException('A task needs a user or a role assignee');
    }
    await this.tasks.save(task);
    return this.findById(task.checklistId);
  }

  async cancel(checklistId: string): Promise<Checklist> {
    const c = await this.findById(checklistId);
    if (c.status !== ChecklistStatus.IN_PROGRESS)
      throw new BadRequestException('Checklist is not in progress');
    await this.checklists.update(checklistId, {
      status: ChecklistStatus.CANCELLED,
    });
    return this.findById(checklistId);
  }

  /** Who may read a checklist: HR, the employee themself, or their reporting chain. */
  async canView(checklist: Checklist, actor: AuthUser): Promise<boolean> {
    if (actor.permissions.includes(PERMISSIONS.ONBOARDING_READ)) return true;
    const emp =
      checklist.employee ??
      (await this.employees.findById(checklist.employeeId));
    if (emp.userId === actor.id) return true;
    const me = await this.employees.findByUserId(actor.id);
    return me ? this.employees.isInReportingChain(me.id, emp.id) : false;
  }

  // ── Reminders (daily job) ─────────────────────────────────────────────

  /**
   * Sends one digest per assignee covering tasks due within `horizonDays`
   * or overdue, at most once per calendar day per task. Returns the count
   * of digests queued.
   */
  async sendReminders(
    horizonDays = 1,
    now: Date = new Date(),
  ): Promise<number> {
    const today = todayIso(now);
    const cutoff = addDays(today, horizonDays);
    const startOfDay = new Date(`${today}T00:00:00Z`);

    const due = await this.tasks.find({
      where: {
        status: In(OPEN_TASK_STATUSES),
        dueDate: LessThanOrEqual(cutoff),
        checklist: { status: ChecklistStatus.IN_PROGRESS },
      },
      relations: { checklist: { employee: true }, assignee: true },
      order: { dueDate: 'ASC' },
    });
    const fresh = due.filter(
      (t) => !t.lastRemindedAt || t.lastRemindedAt < startOfDay,
    );

    // Group by concrete user; role-based tasks without a user go to HR via role.
    const byUser = new Map<string, ChecklistTask[]>();
    for (const t of fresh) {
      if (!t.assigneeUserId) continue; // role-only tasks are visible in "my tasks"; no digest target
      byUser.set(t.assigneeUserId, [
        ...(byUser.get(t.assigneeUserId) ?? []),
        t,
      ]);
    }

    let sent = 0;
    for (const [userId, tasks] of byUser) {
      const lines = tasks.map((t) => {
        const delta = daysBetween(today, t.dueDate);
        const when =
          delta < 0
            ? `OVERDUE by ${-delta}d`
            : delta === 0
              ? 'due today'
              : `due ${t.dueDate}`;
        return `• ${t.title} — ${t.checklist.employee.fullName} (${when})`;
      });
      await this.notifications.notify({
        template: 'TASKS_DUE',
        to: { userId },
        data: {
          firstName: tasks[0].assignee?.firstName ?? 'there',
          taskCount: tasks.length,
          overdueCount: tasks.filter((t) => t.dueDate < today).length,
          taskSummary: lines.join('\n'),
        },
        dedupeKey: `tasks-due:${userId}:${today}`,
      });
      await this.tasks.update(
        { id: In(tasks.map((t) => t.id)) },
        { lastRemindedAt: now },
      );
      sent++;
    }
    return sent;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async loadTask(taskId: string): Promise<ChecklistTask> {
    const task = await this.tasks.findOne({
      where: { id: taskId },
      relations: { checklist: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  private canActOn(task: ChecklistTask, actor: AuthUser): boolean {
    if (actor.permissions.includes(PERMISSIONS.ONBOARDING_MANAGE)) return true;
    if (task.assigneeUserId === actor.id) return true;
    return (
      !!task.assigneeRoleName && actor.roles.includes(task.assigneeRoleName)
    );
  }

  private resolveAssignee(
    rule: AssigneeRule,
    emp: { userId: string | null; manager: { userId: string | null } | null },
  ): string | null {
    switch (rule) {
      case AssigneeRule.EMPLOYEE:
        return emp.userId;
      case AssigneeRule.MANAGER:
        return emp.manager?.userId ?? null;
      default:
        return null;
    }
  }

  private async completeIfFinished(checklistId: string): Promise<void> {
    const c = await this.checklists.findOne({
      where: { id: checklistId },
      relations: { tasks: true },
    });
    if (!c || c.status !== ChecklistStatus.IN_PROGRESS) return;
    const blocking = c.tasks.some(
      (t) => t.isRequired && OPEN_TASK_STATUSES.includes(t.status),
    );
    if (!blocking) await this.complete(c);
  }

  private async complete(c: Checklist): Promise<void> {
    await this.checklists.update(c.id, {
      status: ChecklistStatus.COMPLETED,
      completedAt: new Date(),
    });
    this.events.emit(
      ONBOARDING_EVENTS.CHECKLIST_COMPLETED,
      new ChecklistCompletedEvent(c.id, c.employeeId, c.type),
    );

    if (c.type === ChecklistType.ONBOARDING) {
      const emp = await this.employees.findById(c.employeeId);
      if (emp.status === EmployeeStatus.ONBOARDING) {
        await this.employees.changeStatus(
          c.employeeId,
          {
            status: EmployeeStatus.ACTIVE,
            effectiveDate: todayIso(),
            notes: 'Onboarding checklist completed',
          },
          null, // system action
        );
      }
    }
  }
}

export function progressOf(tasks: ChecklistTask[]): ChecklistProgress {
  const today = todayIso();
  const isClosed = (t: ChecklistTask) => !OPEN_TASK_STATUSES.includes(t.status);
  const required = tasks.filter((t) => t.isRequired);
  const done = tasks.filter(isClosed).length;
  const requiredDone = required.filter(isClosed).length;
  return {
    total: tasks.length,
    done,
    required: required.length,
    requiredDone,
    overdue: tasks.filter((t) => !isClosed(t) && t.dueDate < today).length,
    percent: tasks.length === 0 ? 100 : Math.round((done / tasks.length) * 100),
  };
}
