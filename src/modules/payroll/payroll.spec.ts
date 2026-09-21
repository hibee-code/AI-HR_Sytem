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
  DefaultPayrollCalculator,
  PAYROLL_CALCULATOR,
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
