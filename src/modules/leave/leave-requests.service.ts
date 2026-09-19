import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import {
  Brackets,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { addDays, daysBetween, todayIso } from '../../common/utils/date';
import {
  Employee,
  EmployeeStatus,
} from '../employees/entities/employee.entity';
import { EmployeesService } from '../employees/employees.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import {
  CreateLeaveRequestDto,
  ListLeaveRequestsQueryDto,
} from './dto/leave.dto';
import {
  HalfDay,
  LeaveRequest,
  LeaveRequestStatus,
} from './entities/leave-request.entity';
import { LeavePolicyService } from './leave-policy.service';

/** Approved leave at least this long (calendar days) flips the employee to ON_LEAVE. */
export const LONG_LEAVE_CALENDAR_DAYS = 30;

const ACTIVE_STATUSES = [
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.APPROVED,
];

@Injectable()
export class LeaveRequestsService {
  constructor(
    @InjectRepository(LeaveRequest)
    private readonly requests: Repository<LeaveRequest>,
    private readonly policy: LeavePolicyService,
    private readonly employees: EmployeesService,
    private readonly notifications: NotificationsService,
    private readonly logger: Logger,
  ) {}

  // ── Submit ────────────────────────────────────────────────────────────

  async submit(
    employeeId: string,
    dto: CreateLeaveRequestDto,
    actorUserId: string,
  ): Promise<LeaveRequest> {
    const emp = await this.employees.findById(employeeId);
    if (emp.status === EmployeeStatus.TERMINATED)
      throw new BadRequestException('Employee is terminated');

    const type = await this.policy.findType(dto.leaveTypeId);
    if (!type.isActive) throw new BadRequestException('Leave type is inactive');
    const halfDay = dto.halfDay ?? HalfDay.NONE;
    if (halfDay !== HalfDay.NONE && !type.allowHalfDay) {
      throw new BadRequestException(`${type.name} does not allow half days`);
    }
    if (dto.startDate.slice(0, 4) !== dto.endDate.slice(0, 4)) {
      throw new BadRequestException(
        'A request must fall within one calendar year; split it at 31 December',
      );
    }
    if (dto.startDate < emp.hireDate)
      throw new BadRequestException('Leave cannot start before the hire date');

    const days = await this.policy.countWorkingDays(
      dto.startDate,
      dto.endDate,
      halfDay,
    );
    if (days === 0)
      throw new BadRequestException(
        'The selected dates contain no working days',
      );

    const overlap = await this.requests.findOne({
      where: {
        employeeId,
        status: In(ACTIVE_STATUSES),
        startDate: LessThanOrEqual(dto.endDate),
        endDate: MoreThanOrEqual(dto.startDate),
      },
    });
    if (overlap)
      throw new ConflictException(
        `Overlaps an existing ${overlap.status.toLowerCase()} request`,
      );

    const year = Number(dto.startDate.slice(0, 4));
    if (type.requiresBalance) {
      const balance = await this.policy.ensureBalance(
        employeeId,
        type.id,
        year,
      );
      if (balance.available(dto.startDate) < days) {
        throw new BadRequestException(
          `Insufficient ${type.name} balance: ${balance.available(dto.startDate)} day(s) available, ${days} requested`,
        );
      }
      await this.policy.applyToBalance(balance, { pending: days });
    }

    const request = await this.requests.save(
      this.requests.create({
        employeeId,
        leaveTypeId: type.id,
        startDate: dto.startDate,
        endDate: dto.endDate,
        halfDay,
        days,
        year,
        reason: dto.reason ?? null,
        status: LeaveRequestStatus.PENDING,
        approverUserId: emp.manager?.userId ?? null,
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        attachmentDocumentId: dto.attachmentDocumentId ?? null,
        statusApplied: false,
      }),
    );

    await this.notifyApprover(request, emp, actorUserId);
    return this.findById(request.id);
  }

  // ── Decide ────────────────────────────────────────────────────────────

  async approve(
    id: string,
    actor: AuthUser,
    note?: string,
  ): Promise<LeaveRequest> {
    const r = await this.loadForDecision(id, actor);
    if (r.leaveType.requiresBalance) {
      const balance = await this.policy.ensureBalance(
        r.employeeId,
        r.leaveTypeId,
        r.year,
      );
      await this.policy.applyToBalance(balance, {
        pending: -r.days,
        used: r.days,
      });
    }
    await this.requests.update(id, {
      status: LeaveRequestStatus.APPROVED,
      decidedByUserId: actor.id,
      decidedAt: new Date(),
      decisionNote: note ?? null,
    });
    await this.applyLongLeaveStatus(r, actor.id);
    await this.notifyDecision(r, 'approved', note);
    return this.findById(id);
  }

  async reject(
    id: string,
    actor: AuthUser,
    note?: string,
  ): Promise<LeaveRequest> {
    const r = await this.loadForDecision(id, actor);
    await this.releaseReservation(r);
    await this.requests.update(id, {
      status: LeaveRequestStatus.REJECTED,
      decidedByUserId: actor.id,
      decidedAt: new Date(),
      decisionNote: note ?? null,
    });
    await this.notifyDecision(r, 'rejected', note);
    return this.findById(id);
  }

  /**
   * Employee (or HR) withdraws a request. Pending: always. Approved: only
   * before it starts, unless HR. Used/pending days are given back.
   */
  async cancel(
    id: string,
    actor: AuthUser,
    note?: string,
  ): Promise<LeaveRequest> {
    const r = await this.findById(id);
    const isHr = actor.permissions.includes(PERMISSIONS.LEAVE_READ_ALL);
    const isOwner = r.employee.userId === actor.id;
    if (!isHr && !isOwner) throw new ForbiddenException();
    if (!ACTIVE_STATUSES.includes(r.status))
      throw new BadRequestException(
        `Request is already ${r.status.toLowerCase()}`,
      );
    if (
      r.status === LeaveRequestStatus.APPROVED &&
      !isHr &&
      r.startDate <= todayIso()
    ) {
      throw new BadRequestException(
        'Approved leave that has started can only be cancelled by HR',
      );
    }

    await this.releaseReservation(r);
    await this.requests.update(id, {
      status: LeaveRequestStatus.CANCELLED,
      decidedByUserId: actor.id,
      decidedAt: new Date(),
      decisionNote: note ?? null,
    });
    if (r.statusApplied) await this.revertLongLeaveStatus(r);

    if (r.approverUserId && r.approverUserId !== actor.id) {
      await this.notifications.notify({
        template: 'LEAVE_CANCELLED',
        to: { userId: r.approverUserId },
        data: {
          employeeName: r.employee.fullName,
          leaveType: r.leaveType.name,
          startDate: r.startDate,
          endDate: r.endDate,
        },
        dedupeKey: `leave.cancelled:${r.id}`,
      });
    }
    return this.findById(id);
  }

  // ── Read ──────────────────────────────────────────────────────────────

  async findById(id: string): Promise<LeaveRequest> {
    const r = await this.requests.findOne({
      where: { id },
      relations: {
        employee: { department: true },
        leaveType: true,
        approver: true,
      },
    });
    if (!r) throw new NotFoundException('Leave request not found');
    return r;
  }

  async list(
    query: ListLeaveRequestsQueryDto,
    restrictToEmployeeIds?: string[],
  ): Promise<PaginatedResponse<LeaveRequest>> {
    const qb = this.requests
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.employee', 'e')
      .innerJoinAndSelect('r.leaveType', 't')
      .leftJoinAndSelect('r.approver', 'a')
      .orderBy('r.startDate', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    if (restrictToEmployeeIds) {
      if (restrictToEmployeeIds.length === 0)
        return new PaginatedResponse([], 0, query);
      qb.andWhere('r.employeeId IN (:...ids)', { ids: restrictToEmployeeIds });
    }
    if (query.employeeId)
      qb.andWhere('r.employeeId = :employeeId', {
        employeeId: query.employeeId,
      });
    if (query.departmentId)
      qb.andWhere('e.departmentId = :departmentId', {
        departmentId: query.departmentId,
      });
    if (query.leaveTypeId)
      qb.andWhere('r.leaveTypeId = :leaveTypeId', {
        leaveTypeId: query.leaveTypeId,
      });
    if (query.status)
      qb.andWhere('r.status = :status', { status: query.status });
    if (query.from) qb.andWhere('r.endDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('r.startDate <= :to', { to: query.to });

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResponse(data, total, query);
  }

  /** Requests awaiting this approver (their direct pool), plus the HR pool for HR. */
  pendingFor(actor: AuthUser): Promise<LeaveRequest[]> {
    const qb = this.requests
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.employee', 'e')
      .innerJoinAndSelect('r.leaveType', 't')
      .where('r.status = :pending', { pending: LeaveRequestStatus.PENDING })
      .orderBy('r.startDate', 'ASC');
    if (actor.permissions.includes(PERMISSIONS.LEAVE_READ_ALL)) {
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('r.approverUserId = :uid')
            .orWhere('r.approverUserId IS NULL'),
        ),
        { uid: actor.id },
      );
    } else {
      qb.andWhere('r.approverUserId = :uid', { uid: actor.id });
    }
    return qb.getMany();
  }

  async canView(r: LeaveRequest, actor: AuthUser): Promise<boolean> {
    if (actor.permissions.includes(PERMISSIONS.LEAVE_READ_ALL)) return true;
    if (r.employee.userId === actor.id || r.approverUserId === actor.id)
      return true;
    if (!actor.permissions.includes(PERMISSIONS.LEAVE_READ_TEAM)) return false;
    const me = await this.employees.findByUserId(actor.id);
    return me ? this.employees.isInReportingChain(me.id, r.employeeId) : false;
  }

  // ── Daily status sync (job) ───────────────────────────────────────────

  /**
   * Flips employees to ON_LEAVE when a long approved leave starts and back
   * to ACTIVE the day after it ends. Idempotent; safe to re-run.
   */
  async syncEmployeeStatuses(
    today: string = todayIso(),
  ): Promise<{ started: number; ended: number }> {
    const starting = await this.requests.find({
      where: {
        status: LeaveRequestStatus.APPROVED,
        statusApplied: false,
        startDate: LessThanOrEqual(today),
        endDate: MoreThanOrEqual(today),
      },
      relations: { employee: true },
    });
    let started = 0;
    for (const r of starting) {
      if (!isLongLeave(r)) continue;
      if (await this.setOnLeave(r, null)) started++;
    }

    const ending = await this.requests.find({
      where: {
        status: LeaveRequestStatus.APPROVED,
        statusApplied: true,
        endDate: LessThanOrEqual(addDays(today, -1)),
      },
      relations: { employee: true },
    });
    let ended = 0;
    for (const r of ending) {
      await this.revertLongLeaveStatus(r);
      ended++;
    }
    return { started, ended };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async loadForDecision(
    id: string,
    actor: AuthUser,
  ): Promise<LeaveRequest> {
    const r = await this.findById(id);
    if (r.status !== LeaveRequestStatus.PENDING)
      throw new BadRequestException(
        `Request is already ${r.status.toLowerCase()}`,
      );
    if (r.employee.userId === actor.id)
      throw new ForbiddenException('You cannot decide your own request');

    const isHr = actor.permissions.includes(PERMISSIONS.LEAVE_READ_ALL);
    if (isHr) return r;
    if (r.approverUserId !== actor.id) {
      // Not the designated approver: allow anyone above in the chain.
      const me = await this.employees.findByUserId(actor.id);
      const inChain = me
        ? await this.employees.isInReportingChain(me.id, r.employeeId)
        : false;
      if (!inChain) throw new ForbiddenException('Not your report');
    }
    return r;
  }

  private async releaseReservation(r: LeaveRequest): Promise<void> {
    if (!r.leaveType.requiresBalance) return;
    const balance = await this.policy.ensureBalance(
      r.employeeId,
      r.leaveTypeId,
      r.year,
    );
    await this.policy.applyToBalance(
      balance,
      r.status === LeaveRequestStatus.PENDING
        ? { pending: -r.days }
        : { used: -r.days },
    );
  }

  private async applyLongLeaveStatus(
    r: LeaveRequest,
    actorUserId: string | null,
  ): Promise<void> {
    if (!isLongLeave(r)) return;
    const today = todayIso();
    if (r.startDate <= today && r.endDate >= today)
      await this.setOnLeave(r, actorUserId);
    // Future long leave is picked up by the daily sync job.
  }

  private async setOnLeave(
    r: LeaveRequest,
    actorUserId: string | null,
  ): Promise<boolean> {
    const emp = r.employee ?? (await this.employees.findById(r.employeeId));
    if (emp.status !== EmployeeStatus.ACTIVE) return false;
    await this.employees.changeStatus(
      r.employeeId,
      {
        status: EmployeeStatus.ON_LEAVE,
        effectiveDate: r.startDate,
        notes: `Leave request ${r.id}`,
      },
      actorUserId,
    );
    await this.requests.update(r.id, { statusApplied: true });
    return true;
  }

  private async revertLongLeaveStatus(r: LeaveRequest): Promise<void> {
    const emp = await this.employees.findById(r.employeeId);
    if (emp.status === EmployeeStatus.ON_LEAVE) {
      await this.employees.changeStatus(
        r.employeeId,
        {
          status: EmployeeStatus.ACTIVE,
          effectiveDate: addDays(r.endDate, 1),
          notes: `Returned from leave ${r.id}`,
        },
        null,
      );
    }
    await this.requests.update(r.id, { statusApplied: false });
  }

  private async notifyApprover(
    r: LeaveRequest,
    emp: Employee,
    actorUserId: string,
  ): Promise<void> {
    const type = await this.policy.findType(r.leaveTypeId);
    const data = {
      employeeName: emp.fullName,
      leaveType: type.name,
      startDate: r.startDate,
      endDate: r.endDate,
      days: r.days,
      reason: r.reason ?? '',
    };
    if (r.approverUserId && r.approverUserId !== actorUserId) {
      await this.notifications.notify({
        template: 'LEAVE_REQUESTED',
        to: { userId: r.approverUserId },
        data,
        dedupeKey: `leave.requested:${r.id}`,
      });
    } else if (!r.approverUserId) {
      this.logger.warn(
        { requestId: r.id },
        'leave request has no manager approver; visible in the HR pool',
      );
    }
  }

  private async notifyDecision(
    r: LeaveRequest,
    decision: 'approved' | 'rejected',
    note?: string,
  ): Promise<void> {
    if (!r.employee.userId) return;
    await this.notifications.notify({
      template: 'LEAVE_DECIDED',
      to: { userId: r.employee.userId },
      data: {
        firstName: r.employee.firstName,
        leaveType: r.leaveType.name,
        startDate: r.startDate,
        endDate: r.endDate,
        days: r.days,
        decision,
        note: note ?? '',
      },
      dedupeKey: `leave.decided:${r.id}:${decision}`,
    });
  }
}

export function isLongLeave(
  r: Pick<LeaveRequest, 'startDate' | 'endDate'>,
): boolean {
  return daysBetween(r.startDate, r.endDate) + 1 >= LONG_LEAVE_CALENDAR_DAYS;
}
