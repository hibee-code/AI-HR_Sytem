import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, LessThan, Repository } from 'typeorm';
import { todayIso } from '../../common/utils/date';
import {
  Employee,
  EmployeeStatus,
} from '../employees/entities/employee.entity';
import { LeaveRequestStatus } from '../leave/entities/leave-request.entity';
import { LeaveRequest } from '../leave/entities/leave-request.entity';
import { ManualRecordDto, UpdateRecordDto } from './dto/attendance.dto';
import {
  AttendanceRecord,
  AttendanceSource,
  MAX_SESSION_HOURS,
} from './entities/attendance-record.entity';

export interface DailySummary {
  date: string;
  workedMinutes: number;
  sessions: number;
  hasOpenSession: boolean;
}

export interface MonthlyRow {
  employeeId: string;
  employeeNumber: string;
  fullName: string;
  department: string;
  daysPresent: number;
  workedMinutes: number;
  leaveDays: number;
  autoClosedSessions: number;
}

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(AttendanceRecord)
    private readonly records: Repository<AttendanceRecord>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(LeaveRequest)
    private readonly leave: Repository<LeaveRequest>,
  ) {}

  // ── Clocking ──────────────────────────────────────────────────────────

  async clockIn(
    employeeId: string,
    note?: string,
    now: Date = new Date(),
  ): Promise<AttendanceRecord> {
    if (await this.openSession(employeeId))
      throw new ConflictException(
        'You already have an open session; clock out first',
      );
    return this.records.save(
      this.records.create({
        employeeId,
        date: todayIso(now),
        clockIn: now,
        clockOut: null,
        workedMinutes: null,
        source: AttendanceSource.CLOCK,
        autoClosed: false,
        note: note ?? null,
        createdByUserId: null,
      }),
    );
  }

  async clockOut(
    employeeId: string,
    note?: string,
    now: Date = new Date(),
  ): Promise<AttendanceRecord> {
    const open = await this.openSession(employeeId);
    if (!open) throw new BadRequestException('No open session to clock out of');
    open.clockOut = now;
    open.workedMinutes = minutesBetween(open.clockIn, now);
    if (note) open.note = open.note ? `${open.note}\n${note}` : note;
    return this.records.save(open);
  }

  openSession(employeeId: string): Promise<AttendanceRecord | null> {
    return this.records.findOne({
      where: { employeeId, clockOut: IsNull() },
      order: { clockIn: 'DESC' },
    });
  }

  // ── Manual entries (HR) ───────────────────────────────────────────────

  async createManual(
    dto: ManualRecordDto,
    byUserId: string,
  ): Promise<AttendanceRecord> {
    const clockIn = new Date(dto.clockIn);
    const clockOut = dto.clockOut ? new Date(dto.clockOut) : null;
    this.assertRange(clockIn, clockOut);
    if (!(await this.employees.exists({ where: { id: dto.employeeId } })))
      throw new NotFoundException('Employee not found');
    if (!clockOut && (await this.openSession(dto.employeeId))) {
      throw new ConflictException('Employee already has an open session');
    }
    return this.records.save(
      this.records.create({
        employeeId: dto.employeeId,
        date: todayIso(clockIn),
        clockIn,
        clockOut,
        workedMinutes: clockOut ? minutesBetween(clockIn, clockOut) : null,
        source: AttendanceSource.MANUAL,
        autoClosed: false,
        note: dto.note ?? null,
        createdByUserId: byUserId,
      }),
    );
  }

  async update(id: string, dto: UpdateRecordDto): Promise<AttendanceRecord> {
    const r = await this.findById(id);
    if (dto.clockIn !== undefined) r.clockIn = new Date(dto.clockIn);
    if (dto.clockOut !== undefined)
      r.clockOut = dto.clockOut ? new Date(dto.clockOut) : null;
    if (dto.note !== undefined) r.note = dto.note;
    this.assertRange(r.clockIn, r.clockOut);
    r.date = todayIso(r.clockIn);
    r.workedMinutes = r.clockOut ? minutesBetween(r.clockIn, r.clockOut) : null;
    r.source = AttendanceSource.MANUAL;
    r.autoClosed = false;
    return this.records.save(r);
  }

  async remove(id: string): Promise<void> {
    await this.records.remove(await this.findById(id));
  }

  async findById(id: string): Promise<AttendanceRecord> {
    const r = await this.records.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Attendance record not found');
    return r;
  }

  // ── Reads ─────────────────────────────────────────────────────────────

  async recordsFor(
    employeeId: string,
    from: string,
    to: string,
  ): Promise<{ records: AttendanceRecord[]; daily: DailySummary[] }> {
    const records = await this.records.find({
      where: { employeeId, date: Between(from, to) },
      order: { clockIn: 'ASC' },
    });
    const byDate = new Map<string, DailySummary>();
    for (const r of records) {
      const d = byDate.get(r.date) ?? {
        date: r.date,
        workedMinutes: 0,
        sessions: 0,
        hasOpenSession: false,
      };
      d.sessions++;
      d.workedMinutes += r.workedMinutes ?? 0;
      if (r.isOpen) d.hasOpenSession = true;
      byDate.set(r.date, d);
    }
    return { records, daily: [...byDate.values()] };
  }

  /** Per-employee totals for a month; optionally one department; optionally a subset of employees. */
  async monthlyReport(
    month: string,
    opts: { departmentId?: string; employeeIds?: string[] } = {},
  ): Promise<MonthlyRow[]> {
    const from = `${month}-01`;
    const to = lastDayOfMonth(month);

    const qb = this.employees
      .createQueryBuilder('e')
      .innerJoinAndSelect('e.department', 'd')
      .where('e.status != :terminated', {
        terminated: EmployeeStatus.TERMINATED,
      });
    if (opts.departmentId)
      qb.andWhere('e.departmentId = :dep', { dep: opts.departmentId });
    if (opts.employeeIds) {
      if (opts.employeeIds.length === 0) return [];
      qb.andWhere('e.id IN (:...ids)', { ids: opts.employeeIds });
    }
    const emps = await qb.orderBy('e.lastName', 'ASC').getMany();
    if (emps.length === 0) return [];
    const ids = emps.map((e) => e.id);

    const [att, leaveRows] = await Promise.all([
      this.records
        .createQueryBuilder('a')
        .select('a.employee_id', 'employeeId')
        .addSelect('COUNT(DISTINCT a.date)', 'daysPresent')
        .addSelect('COALESCE(SUM(a.worked_minutes), 0)', 'workedMinutes')
        .addSelect(
          'SUM(CASE WHEN a.auto_closed THEN 1 ELSE 0 END)',
          'autoClosed',
        )
        .where('a.employee_id IN (:...ids)', { ids })
        .andWhere('a.date BETWEEN :from AND :to', { from, to })
        .groupBy('a.employee_id')
        .getRawMany<{
          employeeId: string;
          daysPresent: string;
          workedMinutes: string;
          autoClosed: string;
        }>(),
      this.leave
        .createQueryBuilder('l')
        .select('l.employee_id', 'employeeId')
        .addSelect('COALESCE(SUM(l.days), 0)', 'leaveDays')
        .where('l.employee_id IN (:...ids)', { ids })
        .andWhere('l.status = :approved', {
          approved: LeaveRequestStatus.APPROVED,
        })
        .andWhere('l.start_date <= :to AND l.end_date >= :from', { from, to })
        .groupBy('l.employee_id')
        .getRawMany<{ employeeId: string; leaveDays: string }>(),
    ]);
    const attBy = new Map(att.map((a) => [a.employeeId, a]));
    const leaveBy = new Map(
      leaveRows.map((l) => [l.employeeId, Number(l.leaveDays)]),
    );

    return emps.map((e) => ({
      employeeId: e.id,
      employeeNumber: e.employeeNumber,
      fullName: e.fullName,
      department: e.department.name,
      daysPresent: Number(attBy.get(e.id)?.daysPresent ?? 0),
      workedMinutes: Number(attBy.get(e.id)?.workedMinutes ?? 0),
      leaveDays: leaveBy.get(e.id) ?? 0,
      autoClosedSessions: Number(attBy.get(e.id)?.autoClosed ?? 0),
    }));
  }

  // ── Daily job ─────────────────────────────────────────────────────────

  /** Closes sessions open longer than MAX_SESSION_HOURS at exactly that length. */
  async autoCloseStaleSessions(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - MAX_SESSION_HOURS * 3_600_000);
    const stale = await this.records.find({
      where: { clockOut: IsNull(), clockIn: LessThan(cutoff) },
    });
    for (const r of stale) {
      r.clockOut = new Date(
        r.clockIn.getTime() + MAX_SESSION_HOURS * 3_600_000,
      );
      r.workedMinutes = MAX_SESSION_HOURS * 60;
      r.autoClosed = true;
      r.note = r.note
        ? `${r.note}\n[auto-closed]`
        : '[auto-closed: forgot to clock out]';
    }
    if (stale.length) await this.records.save(stale);
    return stale.length;
  }

  private assertRange(clockIn: Date, clockOut: Date | null): void {
    if (Number.isNaN(clockIn.getTime()))
      throw new BadRequestException('Invalid clockIn');
    if (clockOut) {
      if (Number.isNaN(clockOut.getTime()))
        throw new BadRequestException('Invalid clockOut');
      if (clockOut <= clockIn)
        throw new BadRequestException('clockOut must be after clockIn');
      if (minutesBetween(clockIn, clockOut) > 24 * 60)
        throw new BadRequestException('A session cannot exceed 24 hours');
    }
  }
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
