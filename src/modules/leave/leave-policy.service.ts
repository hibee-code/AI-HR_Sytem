import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { addDays } from '../../common/utils/date';
import { Employee } from '../employees/entities/employee.entity';
import {
  AdjustBalanceDto,
  CreateLeaveTypeDto,
  PublicHolidayDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto';
import { LeaveBalanceAdjustment } from './entities/leave-balance-adjustment.entity';
import { LeaveBalance, round1 } from './entities/leave-balance.entity';
import { HalfDay } from './entities/leave-request.entity';
import { LeaveType } from './entities/leave-type.entity';
import { PublicHoliday } from './entities/public-holiday.entity';

/**
 * Policy data (types, holidays), day arithmetic, and balance provisioning.
 * Request workflow lives in LeaveRequestsService.
 */
@Injectable()
export class LeavePolicyService {
  constructor(
    @InjectRepository(LeaveType) private readonly types: Repository<LeaveType>,
    @InjectRepository(PublicHoliday)
    private readonly holidays: Repository<PublicHoliday>,
    @InjectRepository(LeaveBalance)
    private readonly balances: Repository<LeaveBalance>,
    @InjectRepository(LeaveBalanceAdjustment)
    private readonly adjustments: Repository<LeaveBalanceAdjustment>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
  ) {}

  // ── Leave types ───────────────────────────────────────────────────────

  findTypes(includeInactive = false): Promise<LeaveType[]> {
    return this.types.find({
      where: includeInactive ? {} : { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async findType(id: string): Promise<LeaveType> {
    const t = await this.types.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Leave type not found');
    return t;
  }

  async createType(dto: CreateLeaveTypeDto): Promise<LeaveType> {
    if (await this.types.exists({ where: { code: dto.code } })) {
      throw new ConflictException(`Leave type ${dto.code} already exists`);
    }
    return this.types.save(
      this.types.create({
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        defaultDays: dto.defaultDays,
        isPaid: dto.isPaid ?? true,
        requiresBalance: dto.requiresBalance ?? true,
        carryOverMaxDays: dto.carryOverMaxDays ?? 0,
        carryOverExpiresOn: dto.carryOverExpiresOn ?? null,
        allowHalfDay: dto.allowHalfDay ?? true,
        isActive: true,
        sortOrder: dto.sortOrder ?? 0,
      }),
    );
  }

  async updateType(id: string, dto: UpdateLeaveTypeDto): Promise<LeaveType> {
    const t = await this.findType(id);
    if (
      dto.code &&
      dto.code !== t.code &&
      (await this.types.exists({ where: { code: dto.code } }))
    ) {
      throw new ConflictException(`Leave type ${dto.code} already exists`);
    }
    Object.assign(
      t,
      Object.fromEntries(
        Object.entries(dto).filter(([, v]) => v !== undefined),
      ),
    );
    return this.types.save(t);
  }

  // ── Public holidays ───────────────────────────────────────────────────

  findHolidays(year?: number): Promise<PublicHoliday[]> {
    return this.holidays.find({
      where: year ? { date: Between(`${year}-01-01`, `${year}-12-31`) } : {},
      order: { date: 'ASC' },
    });
  }

  async addHoliday(dto: PublicHolidayDto): Promise<PublicHoliday> {
    if (await this.holidays.exists({ where: { date: dto.date } })) {
      throw new ConflictException(`A holiday already exists on ${dto.date}`);
    }
    return this.holidays.save(this.holidays.create(dto));
  }

  async removeHoliday(id: string): Promise<void> {
    const h = await this.holidays.findOne({ where: { id } });
    if (!h) throw new NotFoundException('Holiday not found');
    await this.holidays.remove(h);
  }

  // ── Day arithmetic ────────────────────────────────────────────────────

  /**
   * Working days between two dates inclusive: weekends and public holidays
   * are skipped; a half-day marker on a single-day request halves it.
   */
  async countWorkingDays(
    startDate: string,
    endDate: string,
    halfDay: HalfDay = HalfDay.NONE,
  ): Promise<number> {
    if (endDate < startDate)
      throw new BadRequestException('endDate must be on or after startDate');
    if (halfDay !== HalfDay.NONE && startDate !== endDate) {
      throw new BadRequestException(
        'Half days are only allowed on single-day requests',
      );
    }
    const holidays = new Set(
      (
        await this.holidays.find({
          where: { date: Between(startDate, endDate) },
        })
      ).map((h) => h.date),
    );
    let days = 0;
    for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
      if (isWeekend(d) || holidays.has(d)) continue;
      days++;
    }
    if (halfDay !== HalfDay.NONE) days = days === 0 ? 0 : 0.5;
    return days;
  }

  // ── Balances ──────────────────────────────────────────────────────────

  /**
   * Returns the balance row for employee × type × year, creating it on first
   * touch: entitlement pro-rated in the hire year, carry-over taken from the
   * previous year's row (if it exists) capped by policy.
   */
  async ensureBalance(
    employeeId: string,
    leaveTypeId: string,
    year: number,
  ): Promise<LeaveBalance> {
    const existing = await this.balances.findOne({
      where: { employeeId, leaveTypeId, year },
      relations: { leaveType: true },
    });
    if (existing) return existing;

    const [type, employee] = await Promise.all([
      this.findType(leaveTypeId),
      this.employees.findOneOrFail({ where: { id: employeeId } }),
    ]);

    const entitled = proRate(type.defaultDays, employee.hireDate, year);

    let carriedOver = 0;
    let carryOverExpiresOn: string | null = null;
    if (type.carryOverMaxDays > 0) {
      const prev = await this.balances.findOne({
        where: { employeeId, leaveTypeId, year: year - 1 },
      });
      if (prev) {
        const remaining =
          prev.entitled +
          prev.effectiveCarryOver(`${year - 1}-12-31`) +
          prev.adjustment -
          prev.used;
        carriedOver = round1(
          Math.max(0, Math.min(remaining, type.carryOverMaxDays)),
        );
        if (carriedOver > 0 && type.carryOverExpiresOn)
          carryOverExpiresOn = `${year}-${type.carryOverExpiresOn}`;
      }
    }

    const row = this.balances.create({
      employeeId,
      leaveTypeId,
      year,
      entitled,
      carriedOver,
      carryOverExpiresOn,
      adjustment: 0,
      used: 0,
      pending: 0,
    });
    try {
      await this.balances.insert(row);
    } catch {
      // Lost a race with a concurrent provision; the row now exists.
    }
    return this.balances.findOneOrFail({
      where: { employeeId, leaveTypeId, year },
      relations: { leaveType: true },
    });
  }

  /** All balance rows for an employee in a year, provisioning any missing active types. */
  async balancesFor(
    employeeId: string,
    year: number,
  ): Promise<(LeaveBalance & { available: number })[]> {
    const types = (await this.findTypes()).filter((t) => t.requiresBalance);
    const rows = await Promise.all(
      types.map((t) => this.ensureBalance(employeeId, t.id, year)),
    );
    return rows.map((b) => Object.assign(b, { available: b.available() }));
  }

  async adjust(
    dto: AdjustBalanceDto,
    byUserId: string,
  ): Promise<LeaveBalance & { available: number }> {
    const type = await this.findType(dto.leaveTypeId);
    if (!type.requiresBalance)
      throw new BadRequestException('This leave type has no balance');
    const balance = await this.ensureBalance(
      dto.employeeId,
      dto.leaveTypeId,
      dto.year,
    );
    if (balance.available() + dto.delta < 0) {
      throw new BadRequestException(
        'Adjustment would make the available balance negative',
      );
    }
    balance.adjustment = round1(balance.adjustment + dto.delta);
    await this.balances.save(balance);
    await this.adjustments.save(
      this.adjustments.create({
        balanceId: balance.id,
        delta: dto.delta,
        reason: dto.reason,
        byUserId,
      }),
    );
    return Object.assign(balance, { available: balance.available() });
  }

  /** Used by the request workflow to move days between pending/used. */
  async applyToBalance(
    balance: LeaveBalance,
    change: { pending?: number; used?: number },
  ): Promise<LeaveBalance> {
    balance.pending = round1(balance.pending + (change.pending ?? 0));
    balance.used = round1(balance.used + (change.used ?? 0));
    return this.balances.save(balance);
  }
}

export function isWeekend(iso: string): boolean {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Full entitlement, except in the hire year where it's scaled by remaining months. */
export function proRate(
  defaultDays: number,
  hireDate: string,
  year: number,
): number {
  const hireYear = Number(hireDate.slice(0, 4));
  if (year < hireYear) return 0;
  if (year > hireYear) return defaultDays;
  const monthsRemaining = 12 - (Number(hireDate.slice(5, 7)) - 1);
  return round1((defaultDays * monthsRemaining) / 12);
}
