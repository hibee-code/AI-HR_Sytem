import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { AuthUser } from '../../common/auth/auth-user.interface';
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
import { UserStatus } from '../users/entities/user.entity';
import { PayrollRun, PayrollRunStatus } from './entities/payroll-run.entity';
import { Payslip } from './entities/payslip.entity';
import {
  LineMethod,
  LineType,
  PayFrequency,
  SalaryStructure,
} from './entities/salary-structure.entity';
import {
  annualPaye,
  NigeriaPayrollCalculator,
  prorationFactor,
} from './nigeria-payroll.calculator';
import {
  DefaultPayrollCalculator,
  PAYROLL_CALCULATOR,
  round2,
} from './payroll-calculator';
import { PayrollService } from './payroll.service';
import { renderPayslipPdf } from './payslip-pdf';

const structure = (o: Partial<SalaryStructure> = {}): SalaryStructure =>
  Object.assign(new SalaryStructure(), {
    id: 's1',
    employeeId: 'e1',
    currency: 'NGN',
    payFrequency: PayFrequency.MONTHLY,
    baseAmount: 1000,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    lines: [
      {
        code: 'HOUSING',
        label: 'Housing',
        type: LineType.EARNING,
        method: LineMethod.PERCENT_OF_BASE,
        value: 20,
      },
      {
        code: 'TRANSPORT',
        label: 'Transport',
        type: LineType.EARNING,
        method: LineMethod.FIXED,
        value: 150,
      },
      {
        code: 'PENSION',
        label: 'Pension',
        type: LineType.DEDUCTION,
        method: LineMethod.PERCENT_OF_BASE,
        value: 8,
      },
      {
        code: 'TAX',
        label: 'PAYE',
        type: LineType.DEDUCTION,
        method: LineMethod.PERCENT_OF_GROSS,
        value: 10,
      },
      {
        code: 'UNION',
        label: 'Union dues',
        type: LineType.DEDUCTION,
        method: LineMethod.FIXED,
        value: 12.5,
      },
    ],
    ...o,
  });

describe('DefaultPayrollCalculator', () => {
  it('base + earnings = gross; deductions by fixed / % base / % gross; 2-dp rounding', () => {
    const c = new DefaultPayrollCalculator().calculate(structure(), {
      start: '2026-10-01',
      end: '2026-10-31',
    });
    expect(c.gross).toBe(1350); // 1000 + 200 + 150
    expect(c.lines.find((l) => l.code === 'PENSION')?.amount).toBe(80);
    expect(c.lines.find((l) => l.code === 'TAX')?.amount).toBe(135);
    expect(c.totalDeductions).toBe(227.5);
    expect(c.net).toBe(1122.5);
    expect(c.lines[0]).toEqual({
      code: 'BASE',
      label: 'Base pay',
      type: LineType.EARNING,
      amount: 1000,
    });
  });

  it('rounds awkward percentages to cents', () => {
    const c = new DefaultPayrollCalculator().calculate(
      structure({
        baseAmount: 333.33,
        lines: [
          {
            code: 'X',
            label: 'x',
            type: LineType.DEDUCTION,
            method: LineMethod.PERCENT_OF_BASE,
            value: 7.5,
          },
        ],
      }),
      { start: '', end: '' },
    );
    expect(c.totalDeductions).toBe(25);
    expect(c.net).toBe(308.33);
  });
});

describe('renderPayslipPdf', () => {
  it('produces a PDF buffer', async () => {
    const pdf = await renderPayslipPdf({
      companyName: 'Acme',
      employeeName: 'Jane Doe',
      employeeNumber: 'EMP-0001',
      department: 'Eng',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      payDate: '2026-10-28',
      payslip: {
        currency: 'NGN',
        gross: 1350,
        totalDeductions: 227.5,
        net: 1122.5,
        lines: [
          {
            code: 'BASE',
            label: 'Base pay',
            type: LineType.EARNING,
            amount: 1000,
          },
        ],
      },
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(500);
  });
});

describe('PayrollService', () => {
  let service: PayrollService;
  let structures: Record<string, jest.Mock>;
  let runs: Record<string, jest.Mock>;
  let payslips: Record<string, jest.Mock>;
  let employeeRepo: { find: jest.Mock };
  let documents: { createSystemDocument: jest.Mock };
  let notifications: { notify: jest.Mock };
  let qb: Record<string, jest.Mock>;

  const run = (o: Partial<PayrollRun> = {}): PayrollRun =>
    Object.assign(new PayrollRun(), {
      id: 'r1',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      payDate: '2026-10-28',
      status: PayrollRunStatus.DRAFT,
      departmentId: null,
      currency: 'NGN',
      totals: {},
      ...o,
    });

  beforeEach(async () => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => structure()),
    };
    structures = {
      findOne: jest.fn(async () => null),
      save: jest.fn(async (s) => s),
      create: jest.fn((v) => Object.assign(new SalaryStructure(), v)),
      createQueryBuilder: jest.fn(() => qb),
      find: jest.fn(),
    };
    runs = {
      findOne: jest.fn(),
      save: jest.fn(async (r) => r),
      create: jest.fn((v) => Object.assign(new PayrollRun(), v)),
      remove: jest.fn(),
    };
    payslips = {
      delete: jest.fn(),
      save: jest.fn(async (p) => Object.assign(p, { id: `p-${p.employeeId}` })),
      create: jest.fn((v) => Object.assign(new Payslip(), v)),
      find: jest.fn(async () => []),
      update: jest.fn(),
      findOne: jest.fn(),
    };
    employeeRepo = { find: jest.fn(async () => []) };
    documents = {
      createSystemDocument: jest.fn(async () => ({ id: 'doc-1' })),
    };
    notifications = { notify: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PayrollService,
        { provide: getRepositoryToken(SalaryStructure), useValue: structures },
        { provide: getRepositoryToken(PayrollRun), useValue: runs },
        { provide: getRepositoryToken(Payslip), useValue: payslips },
        { provide: getRepositoryToken(Employee), useValue: employeeRepo },
        { provide: PAYROLL_CALCULATOR, useClass: DefaultPayrollCalculator },
        {
          provide: EmployeesService,
          useValue: {
            findById: jest.fn(async () => ({ id: 'e1' })),
            findByUserId: jest.fn(async () => ({ id: 'e1' })),
          },
        },
        { provide: DocumentsService, useValue: documents },
        { provide: NotificationsService, useValue: notifications },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              ({ PAYROLL_CURRENCY: 'NGN', APP_NAME: 'Acme' })[k],
          },
        },
      ],
    }).compile();
    service = moduleRef.get(PayrollService);
  });

  describe('createStructure', () => {
    it('closes the previous structure the day before the new one starts', async () => {
      const prev = structure({ effectiveFrom: '2026-01-01' });
      structures.findOne.mockResolvedValue(prev);
      await service.createStructure(
        { employeeId: 'e1', effectiveFrom: '2026-07-01', baseAmount: 1200 },
        'hr',
      );
      expect(prev.effectiveTo).toBe('2026-06-30');
      expect(structures.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          effectiveFrom: '2026-07-01',
          currency: 'NGN',
          effectiveTo: null,
        }),
      );
    });

    it('rejects backdating before the current structure and invalid lines', async () => {
      structures.findOne.mockResolvedValue(
        structure({ effectiveFrom: '2026-07-01' }),
      );
      await expect(
        service.createStructure(
          { employeeId: 'e1', effectiveFrom: '2026-06-01', baseAmount: 1 },
          'hr',
        ),
      ).rejects.toThrow(/must start after/);
      await expect(
        service.createStructure(
          {
            employeeId: 'e1',
            effectiveFrom: '2027-01-01',
            baseAmount: 1,
            lines: [
              {
                code: 'A',
                label: 'a',
                type: LineType.EARNING,
                method: LineMethod.PERCENT_OF_GROSS,
                value: 1,
              },
            ],
          },
          'hr',
        ),
      ).rejects.toThrow(/only valid for deductions/);
    });
  });

  describe('run lifecycle', () => {
    it('calculate builds a payslip per employee with a structure, skips the rest, and totals', async () => {
      runs.findOne.mockResolvedValue(run());
      employeeRepo.find.mockResolvedValue([
        { id: 'e1', status: EmployeeStatus.ACTIVE },
        { id: 'e2', status: EmployeeStatus.ACTIVE },
        { id: 'e3', status: EmployeeStatus.ACTIVE },
      ]);
      qb.getOne
        .mockResolvedValueOnce(structure())
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(structure({ currency: 'USD' }));

      const { run: result, skipped } = await service.calculate('r1');

      expect(payslips.delete).toHaveBeenCalledWith({ runId: 'r1' });
      expect(payslips.save).toHaveBeenCalledTimes(1);
      expect(skipped).toEqual([
        { employeeId: 'e2', reason: 'no salary structure' },
        { employeeId: 'e3', reason: 'currency USD ≠ run NGN' },
      ]);
      expect(result.totals).toEqual({
        employees: 1,
        gross: 1350,
        deductions: 227.5,
        net: 1122.5,
        skipped: 2,
      });
      expect(result.status).toBe(PayrollRunStatus.CALCULATED);
    });

    it('approve renders PDFs into RESTRICTED payslip documents and notifies without amounts', async () => {
      runs.findOne.mockResolvedValue(
        run({ status: PayrollRunStatus.CALCULATED }),
      );
      payslips.find.mockResolvedValue([
        Object.assign(new Payslip(), {
          id: 'p1',
          employeeId: 'e1',
          currency: 'NGN',
          gross: 1350,
          totalDeductions: 227.5,
          net: 1122.5,
          lines: [],
          employee: {
            userId: 'u1',
            firstName: 'Jane',
            fullName: 'Jane Doe',
            employeeNumber: 'EMP-1',
            department: { name: 'Eng' },
          },
        }),
      ]);

      await service.approve('r1', 'hr');

      expect(documents.createSystemDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerEmployeeId: 'e1',
          category: DocumentCategory.PAYSLIP,
          visibility: DocumentVisibility.RESTRICTED,
          file: expect.objectContaining({ mimetype: 'application/pdf' }),
        }),
      );
      expect(payslips.update).toHaveBeenCalledWith('p1', {
        documentId: 'doc-1',
      });
      expect(runs.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PayrollRunStatus.APPROVED,
          approvedByUserId: 'hr',
        }),
      );
      const notice = notifications.notify.mock.calls[0][0];
      expect(notice.template).toBe('PAYSLIP_AVAILABLE');
      expect(JSON.stringify(notice.data)).not.toMatch(/1122|1350/);
    });

    it('guards the state machine', async () => {
      runs.findOne.mockResolvedValue(
        run({ status: PayrollRunStatus.APPROVED }),
      );
      await expect(service.calculate('r1')).rejects.toThrow(
        /Cannot recalculate/,
      );
      await expect(service.deleteRun('r1')).rejects.toThrow(
        BadRequestException,
      );
      runs.findOne.mockResolvedValue(run({ status: PayrollRunStatus.DRAFT }));
      await expect(service.approve('r1', 'hr')).rejects.toThrow(
        /Calculate the run/,
      );
      await expect(service.markPaid('r1')).rejects.toThrow(/Only approved/);
    });
  });

  it('employees see only their own slips from approved/paid runs', async () => {
    const actor: AuthUser = {
      id: 'u1',
      email: 'x',
      status: UserStatus.ACTIVE,
      roles: [],
      permissions: [PERMISSIONS.PAYROLL_READ_SELF],
      passwordChangedAt: null,
      mfaEnabled: false,
    };
    payslips.findOne.mockResolvedValue({
      id: 'p1',
      employeeId: 'e1',
      run: { status: PayrollRunStatus.CALCULATED },
    });
    await expect(service.findPayslip('p1', actor)).rejects.toThrow(
      ForbiddenException,
    );
    payslips.findOne.mockResolvedValue({
      id: 'p1',
      employeeId: 'e1',
      run: { status: PayrollRunStatus.PAID },
    });
    await expect(service.findPayslip('p1', actor)).resolves.toBeDefined();
    payslips.findOne.mockResolvedValue({
      id: 'p1',
      employeeId: 'someone-else',
      run: { status: PayrollRunStatus.PAID },
    });
    await expect(service.findPayslip('p1', actor)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('NigeriaPayrollCalculator', () => {
  const calc = new NigeriaPayrollCalculator();
  const october = { start: '2026-10-01', end: '2026-10-31' };
  const fixed = (code: string, value: number) => ({
    code,
    label: code,
    type: LineType.EARNING,
    method: LineMethod.FIXED,
    value,
  });
  const ngn = (o: Partial<SalaryStructure> = {}) =>
    structure({
      baseAmount: 500_000,
      lines: [fixed('HOUSING', 200_000), fixed('TRANSPORT', 100_000)],
      ...o,
    });

  it('PAYE bands (NTA 2025): first ₦800k free, then 15/18/21/23/25%', () => {
    expect(annualPaye(800_000)).toBe(0);
    expect(annualPaye(3_000_000)).toBe(330_000);
    expect(annualPaye(12_000_000)).toBe(1_950_000);
    expect(annualPaye(60_000_000)).toBe(
      330_000 + 1_620_000 + 2_730_000 + 5_750_000 + 2_500_000,
    );
  });

  it('worked monthly payslip: pension 8% of BHT, NHF 2.5% of basic, annualised PAYE', () => {
    const c = calc.calculate(ngn(), october);
    // gross 800,000; pension 64,000; NHF 12,500; taxable 723,500 × 12 = 8,682,000
    // PAYE = (330,000 + 18% × 5,682,000) / 12 = 112,730
    expect(c.gross).toBe(800_000);
    expect(c.lines.filter((l) => l.type === LineType.DEDUCTION)).toEqual([
      expect.objectContaining({ code: 'PENSION', amount: 64_000 }),
      expect.objectContaining({ code: 'NHF', amount: 12_500 }),
      expect.objectContaining({ code: 'PAYE', amount: 112_730 }),
    ]);
    expect(c.totalDeductions).toBe(189_230);
    expect(c.net).toBe(610_770);
  });

  it('low earners pay no PAYE but still contribute pension and NHF', () => {
    const c = calc.calculate(ngn({ baseAmount: 60_000, lines: [] }), october);
    expect(c.lines.find((l) => l.code === 'PAYE')?.amount).toBe(0);
    expect(c.net).toBe(60_000 - 4_800 - 1_500);
  });

  it('pro-rates a mid-month joiner (base and fixed allowances)', () => {
    const c = calc.calculate(ngn(), october, {
      hireDate: '2026-10-17', // 15 of 31 days
      terminationDate: null,
    });
    expect(c.baseAmount).toBe(round2((500_000 * 15) / 31));
    expect(c.gross).toBe(round2((800_000 * 15) / 31));
    expect(c.lines[0].label).toBe('Base pay (pro-rated 48%)');
    expect(
      prorationFactor(october, {
        hireDate: '2026-11-01',
        terminationDate: null,
      }),
    ).toBe(0);
    expect(
      prorationFactor(october, {
        hireDate: '2020-01-01',
        terminationDate: '2026-10-10',
      }),
    ).toBeCloseTo(10 / 31);
  });

  it("a structure's own PENSION line wins over the computed one", () => {
    const c = calc.calculate(
      ngn({
        lines: [
          fixed('HOUSING', 200_000),
          fixed('TRANSPORT', 100_000),
          {
            code: 'PENSION',
            label: 'Pension (voluntary 10%)',
            type: LineType.DEDUCTION,
            method: LineMethod.PERCENT_OF_BASE,
            value: 10,
          },
        ],
      }),
      october,
    );
    const pension = c.lines.filter((l) => l.code === 'PENSION');
    expect(pension).toHaveLength(1);
    expect(pension[0].amount).toBe(50_000);
  });

  it('a legacy TAX line counts as PAYE (no double taxation)', () => {
    const c = calc.calculate(structure({ baseAmount: 600_000 }), october);
    // own PENSION 8% of base, own TAX 10% of gross; only NHF is added
    expect(c.lines.filter((l) => l.code === 'PAYE')).toHaveLength(0);
    expect(c.lines.find((l) => l.code === 'NHF')?.amount).toBe(15_000);
  });

  it('non-NGN structures get contractual pay only', () => {
    const c = calc.calculate(ngn({ currency: 'USD' }), october);
    expect(c.lines.some((l) => l.code === 'PAYE')).toBe(false);
  });
});
