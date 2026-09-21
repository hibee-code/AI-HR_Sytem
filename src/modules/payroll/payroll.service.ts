import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { addDays } from '../../common/utils/date';
import type { Env } from '../../config/env.schema';
import { DocumentsService } from '../documents/documents.service';
import {
  DocumentCategory,
  DocumentVisibility,
} from '../documents/entities/document.entity';
import {
  Employee,
  EmployeeStatus,
} from '../employees/entities/employee.entity';
import { EmployeesService } from '../employees/employees.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import {
  CreateRunDto,
  CreateStructureDto,
  ListPayslipsQueryDto,
  ListRunsQueryDto,
} from './dto/payroll.dto';
import {
  PayrollRun,
  PayrollRunStatus,
  RunTotals,
} from './entities/payroll-run.entity';
import { Payslip } from './entities/payslip.entity';
import {
  LineMethod,
  LineType,
  SalaryStructure,
} from './entities/salary-structure.entity';
import { PAYROLL_CALCULATOR, round2 } from './payroll-calculator';
import type { PayrollCalculator } from './payroll-calculator';
import { renderPayslipPdf } from './payslip-pdf';

@Injectable()
export class PayrollService {
  private readonly defaultCurrency: string;
  private readonly companyName: string;

  constructor(
    @InjectRepository(SalaryStructure)
    private readonly structures: Repository<SalaryStructure>,
    @InjectRepository(PayrollRun) private readonly runs: Repository<PayrollRun>,
    @InjectRepository(Payslip) private readonly payslips: Repository<Payslip>,
    @InjectRepository(Employee)
    private readonly employeeRepo: Repository<Employee>,
    @Inject(PAYROLL_CALCULATOR) private readonly calculator: PayrollCalculator,
    private readonly employees: EmployeesService,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
  ) {
    this.defaultCurrency = config.get('PAYROLL_CURRENCY', { infer: true });
    this.companyName = config.get('APP_NAME', { infer: true });
  }

  // ── Salary structures ─────────────────────────────────────────────────

  async createStructure(
    dto: CreateStructureDto,
    actorUserId: string,
  ): Promise<SalaryStructure> {
    await this.employees.findById(dto.employeeId); // 404
    const lines = dto.lines ?? [];
    if (new Set(lines.map((l) => l.code)).size !== lines.length)
      throw new BadRequestException('Line codes must be unique');
    for (const l of lines) {
      if (
        l.type === LineType.EARNING &&
        l.method === LineMethod.PERCENT_OF_GROSS
      ) {
        throw new BadRequestException(
          `${l.code}: PERCENT_OF_GROSS is only valid for deductions`,
        );
      }
    }

    const current = await this.structures.findOne({
      where: { employeeId: dto.employeeId, effectiveTo: IsNull() },
    });
    if (current) {
      if (dto.effectiveFrom <= current.effectiveFrom) {
        throw new BadRequestException(
          `New structure must start after the current one (${current.effectiveFrom})`,
        );
      }
      current.effectiveTo = addDays(dto.effectiveFrom, -1);
      await this.structures.save(current);
    }

    return this.structures.save(
      this.structures.create({
        employeeId: dto.employeeId,
        effectiveFrom: dto.effectiveFrom,
        effectiveTo: null,
        currency: dto.currency ?? this.defaultCurrency,
        payFrequency: dto.payFrequency,
        baseAmount: dto.baseAmount,
        lines,
        notes: dto.notes ?? null,
        createdByUserId: actorUserId,
      }),
    );
  }

  structuresFor(employeeId: string): Promise<SalaryStructure[]> {
    return this.structures.find({
      where: { employeeId },
      order: { effectiveFrom: 'DESC' },
    });
  }

  /** Structure in force on a date, or null. */
  structureOn(
    employeeId: string,
    date: string,
  ): Promise<SalaryStructure | null> {
    return this.structures
      .createQueryBuilder('s')
      .where('s.employeeId = :employeeId', { employeeId })
      .andWhere('s.effectiveFrom <= :date', { date })
      .andWhere('(s.effectiveTo IS NULL OR s.effectiveTo >= :date)', { date })
      .orderBy('s.effectiveFrom', 'DESC')
      .getOne();
  }

  // ── Runs ──────────────────────────────────────────────────────────────

  async createRun(dto: CreateRunDto, actorUserId: string): Promise<PayrollRun> {
    if (dto.periodEnd < dto.periodStart)
      throw new BadRequestException(
        'periodEnd must be on or after periodStart',
      );
    const overlap = await this.runs.findOne({
      where: {
        status: Not(PayrollRunStatus.DRAFT),
        departmentId: dto.departmentId ?? IsNull(),
        periodStart: LessThanOrEqual(dto.periodEnd),
        periodEnd: MoreThanOrEqual(dto.periodStart),
      },
    });
    if (overlap)
      throw new BadRequestException(
        `Overlaps run ${overlap.periodStart} – ${overlap.periodEnd} (${overlap.status})`,
      );
    return this.runs.save(
      this.runs.create({
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
        payDate: dto.payDate,
        status: PayrollRunStatus.DRAFT,
        departmentId: dto.departmentId ?? null,
        currency: dto.currency ?? this.defaultCurrency,
        totals: {},
        notes: dto.notes ?? null,
        createdByUserId: actorUserId,
        approvedByUserId: null,
        approvedAt: null,
        paidAt: null,
      }),
    );
  }

  async listRuns(
    query: ListRunsQueryDto,
  ): Promise<PaginatedResponse<PayrollRun>> {
    const [data, total] = await this.runs.findAndCount({
      where: query.status ? { status: query.status } : {},
      relations: { department: true },
      order: { periodStart: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return new PaginatedResponse(data, total, query);
  }

  async findRun(id: string): Promise<PayrollRun> {
    const r = await this.runs.findOne({
      where: { id },
      relations: { department: true },
    });
    if (!r) throw new NotFoundException('Payroll run not found');
    return r;
  }

  /**
   * (Re)computes payslips for every in-scope employee with a structure on the
   * period end. Allowed while DRAFT or CALCULATED; replaces earlier results.
   */
  async calculate(id: string): Promise<{
    run: PayrollRun;
    skipped: { employeeId: string; reason: string }[];
  }> {
    const run = await this.findRun(id);
    if (
      ![PayrollRunStatus.DRAFT, PayrollRunStatus.CALCULATED].includes(
        run.status,
      )
    ) {
      throw new BadRequestException(`Cannot recalculate a ${run.status} run`);
    }

    const emps = await this.employeeRepo.find({
      where: {
        status: In([EmployeeStatus.ACTIVE, EmployeeStatus.ON_LEAVE]),
        ...(run.departmentId ? { departmentId: run.departmentId } : {}),
      },
      order: { lastName: 'ASC' },
    });

    await this.payslips.delete({ runId: id });
    const skipped: { employeeId: string; reason: string }[] = [];
    const totals: RunTotals = {
      employees: 0,
      gross: 0,
      deductions: 0,
      net: 0,
      skipped: 0,
    };

    for (const e of emps) {
      const structure = await this.structureOn(e.id, run.periodEnd);
      if (!structure) {
        skipped.push({ employeeId: e.id, reason: 'no salary structure' });
        continue;
      }
      if (structure.currency !== run.currency) {
        skipped.push({
          employeeId: e.id,
          reason: `currency ${structure.currency} ≠ run ${run.currency}`,
        });
        continue;
      }
      const c = this.calculator.calculate(structure, {
        start: run.periodStart,
        end: run.periodEnd,
      });
      await this.payslips.save(
        this.payslips.create({
          runId: id,
          employeeId: e.id,
          structureId: structure.id,
          currency: run.currency,
          baseAmount: c.baseAmount,
          gross: c.gross,
          totalDeductions: c.totalDeductions,
          net: c.net,
          lines: c.lines,
          documentId: null,
        }),
      );
      totals.employees++;
      totals.gross = round2(totals.gross + c.gross);
      totals.deductions = round2(totals.deductions + c.totalDeductions);
      totals.net = round2(totals.net + c.net);
    }
    totals.skipped = skipped.length;

    run.totals = totals;
    run.status = PayrollRunStatus.CALCULATED;
    await this.runs.save(run);
    return { run: await this.findRun(id), skipped };
  }

  /** Freezes the run, renders PDFs into RESTRICTED payslip documents and tells employees. */
  async approve(id: string, actorUserId: string): Promise<PayrollRun> {
    const run = await this.findRun(id);
    if (run.status !== PayrollRunStatus.CALCULATED)
      throw new BadRequestException('Calculate the run before approving');
    const slips = await this.payslips.find({
      where: { runId: id },
      relations: { employee: { department: true } },
    });
    if (slips.length === 0)
      throw new BadRequestException('Run has no payslips');

    for (const slip of slips) {
      const pdf = await renderPayslipPdf({
        companyName: this.companyName,
        employeeName: slip.employee.fullName,
        employeeNumber: slip.employee.employeeNumber,
        department: slip.employee.department.name,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        payDate: run.payDate,
        payslip: slip,
      });
      const doc = await this.documents.createSystemDocument({
        ownerEmployeeId: slip.employeeId,
        title: `Payslip ${run.periodStart} – ${run.periodEnd}`,
        category: DocumentCategory.PAYSLIP,
        visibility: DocumentVisibility.RESTRICTED,
        file: {
          originalname: `payslip-${run.periodEnd}.pdf`,
          mimetype: 'application/pdf',
          size: pdf.length,
          buffer: pdf,
        },
        createdByUserId: actorUserId,
      });
      await this.payslips.update(slip.id, { documentId: doc.id });
    }

    run.status = PayrollRunStatus.APPROVED;
    run.approvedByUserId = actorUserId;
    run.approvedAt = new Date();
    await this.runs.save(run);

    for (const slip of slips) {
      if (!slip.employee.userId) continue;
      await this.notifications.notify({
        template: 'PAYSLIP_AVAILABLE',
        to: { userId: slip.employee.userId },
        data: {
          firstName: slip.employee.firstName,
          periodStart: run.periodStart,
          periodEnd: run.periodEnd,
          payDate: run.payDate,
        },
        dedupeKey: `payslip.available:${slip.id}`,
      });
    }
    return this.findRun(id);
  }

  async markPaid(id: string): Promise<PayrollRun> {
    const run = await this.findRun(id);
    if (run.status !== PayrollRunStatus.APPROVED)
      throw new BadRequestException('Only approved runs can be marked paid');
    run.status = PayrollRunStatus.PAID;
    run.paidAt = new Date();
    return this.runs.save(run);
  }

  async deleteRun(id: string): Promise<void> {
    const run = await this.findRun(id);
    if (
      ![PayrollRunStatus.DRAFT, PayrollRunStatus.CALCULATED].includes(
        run.status,
      )
    ) {
      throw new BadRequestException('Approved or paid runs cannot be deleted');
    }
    await this.runs.remove(run);
  }

  // ── Payslips ──────────────────────────────────────────────────────────

  async listPayslips(
    query: ListPayslipsQueryDto,
    restrictToEmployeeId?: string,
  ): Promise<PaginatedResponse<Payslip>> {
    const qb = this.payslips
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.run', 'r')
      .innerJoinAndSelect('p.employee', 'e')
      .orderBy('r.periodStart', 'DESC')
      .addOrderBy('e.lastName', 'ASC')
      .skip(query.skip)
      .take(query.limit);
    if (restrictToEmployeeId) {
      // Employees only see slips from approved/paid runs.
      qb.andWhere('p.employeeId = :me', { me: restrictToEmployeeId }).andWhere(
        'r.status IN (:...visible)',
        {
          visible: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID],
        },
      );
    }
    if (query.runId) qb.andWhere('p.runId = :runId', { runId: query.runId });
    if (query.employeeId)
      qb.andWhere('p.employeeId = :employeeId', {
        employeeId: query.employeeId,
      });
    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResponse(data, total, query);
  }

  async findPayslip(id: string, actor: AuthUser): Promise<Payslip> {
    const p = await this.payslips.findOne({
      where: { id },
      relations: { run: true, employee: true, document: true },
    });
    if (!p) throw new NotFoundException('Payslip not found');
    if (actor.permissions.includes(PERMISSIONS.PAYROLL_MANAGE)) return p;
    const me = await this.employees.findByUserId(actor.id);
    const visible = [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID].includes(
      p.run.status,
    );
    if (!me || me.id !== p.employeeId || !visible)
      throw new ForbiddenException();
    return p;
  }
}
