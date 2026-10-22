import { Injectable } from '@nestjs/common';
import { daysBetween } from '../../common/utils/date';
import type { PayslipLine } from './entities/payslip.entity';
import {
  LineMethod,
  LineType,
  PayFrequency,
  SalaryStructure,
} from './entities/salary-structure.entity';
import {
  DefaultPayrollCalculator,
  Employment,
  PayrollCalculator,
  PayslipComputation,
  round2,
} from './payroll-calculator';

/**
 * Statutory parameters in one place. Finance must confirm these before each
 * tax year — they are configuration, not business logic.
 *
 *  - PAYE: Nigeria Tax Act 2025 personal income tax bands (annual, NGN),
 *    effective 1 January 2026. The first ₦800,000 is tax-free.
 *  - Pension: Pension Reform Act 2014 — employee 8% of basic + housing +
 *    transport (the employer's 10% is a cost, not a payslip deduction).
 *  - NHF: National Housing Fund Act — 2.5% of basic salary.
 */
export const NIGERIA_STATUTORY = {
  taxBands: [
    { upTo: 800_000, rate: 0 },
    { upTo: 3_000_000, rate: 0.15 },
    { upTo: 12_000_000, rate: 0.18 },
    { upTo: 25_000_000, rate: 0.21 },
    { upTo: 50_000_000, rate: 0.23 },
    { upTo: Infinity, rate: 0.25 },
  ],
  pensionEmployeeRate: 0.08,
  /** Earning line codes that count as pensionable alongside basic. */
  pensionableCodes: ['HOUSING', 'TRANSPORT'],
  nhfRate: 0.025,
} as const;

const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  [PayFrequency.MONTHLY]: 12,
  [PayFrequency.BIWEEKLY]: 26,
  [PayFrequency.WEEKLY]: 52,
};

/** Progressive tax on an annual taxable amount. */
export function annualPaye(taxable: number): number {
  let tax = 0;
  let lower = 0;
  for (const band of NIGERIA_STATUTORY.taxBands) {
    if (taxable <= lower) break;
    tax += (Math.min(taxable, band.upTo) - lower) * band.rate;
    lower = band.upTo;
  }
  return round2(tax);
}

/** Share of the period the person was employed (calendar days). */
export function prorationFactor(
  period: { start: string; end: string },
  employment?: Employment,
): number {
  if (!employment) return 1;
  const start =
    employment.hireDate > period.start ? employment.hireDate : period.start;
  const end =
    employment.terminationDate && employment.terminationDate < period.end
      ? employment.terminationDate
      : period.end;
  if (end < start) return 0;
  return (
    (daysBetween(start, end) + 1) / (daysBetween(period.start, period.end) + 1)
  );
}

/**
 * Contractual pay (the default calculator) pro-rated for joiners/leavers,
 * plus Nigerian statutory deductions: employee pension, NHF and PAYE.
 * PAYE annualises this period's taxable pay (gross − pension − NHF), applies
 * the bands and divides back. Not handled: rent relief, NHIS, life-assurance
 * reliefs, cumulative (year-to-date) PAYE. Non-NGN structures get contractual
 * pay only.
 */
@Injectable()
export class NigeriaPayrollCalculator implements PayrollCalculator {
  private readonly contractual = new DefaultPayrollCalculator();

  calculate(
    structure: SalaryStructure,
    period: { start: string; end: string },
    employment?: Employment,
  ): PayslipComputation {
    const factor = prorationFactor(period, employment);
    const c = this.contractual.calculate(prorate(structure, factor), period);
    if (factor < 1) {
      c.lines[0].label = `Base pay (pro-rated ${Math.round(factor * 100)}%)`;
    }
    if (structure.currency !== 'NGN') return c;

    const S = NIGERIA_STATUTORY;
    const pensionable =
      c.baseAmount +
      c.lines
        .filter(
          (l) =>
            l.type === LineType.EARNING &&
            (S.pensionableCodes as readonly string[]).includes(
              l.code.toUpperCase(),
            ),
        )
        .reduce((s, l) => s + l.amount, 0);
    // A structure may set PENSION / NHF / PAYE (or a legacy TAX line) itself,
    // e.g. a voluntary higher pension: its own line wins and the computed one
    // is skipped, so nothing is deducted twice.
    const own = (...codes: string[]) =>
      c.lines.find(
        (l) =>
          l.type === LineType.DEDUCTION && codes.includes(l.code.toUpperCase()),
      )?.amount;
    const OWN_CODES: Record<string, string[]> = {
      PENSION: ['PENSION'],
      NHF: ['NHF'],
      PAYE: ['PAYE', 'TAX'],
    };
    const pension =
      own(...OWN_CODES.PENSION) ?? round2(pensionable * S.pensionEmployeeRate);
    const nhf = own(...OWN_CODES.NHF) ?? round2(c.baseAmount * S.nhfRate);
    const periods = PERIODS_PER_YEAR[structure.payFrequency];
    const annualTaxable = Math.max(0, (c.gross - pension - nhf) * periods);
    const paye =
      own(...OWN_CODES.PAYE) ?? round2(annualPaye(annualTaxable) / periods);

    const statutory: PayslipLine[] = [
      line('PENSION', 'Pension (employee 8%)', pension),
      line('NHF', 'National Housing Fund (2.5%)', nhf),
      line('PAYE', 'PAYE income tax', paye),
    ].filter((l) => own(...OWN_CODES[l.code]) === undefined);
    const totalDeductions = round2(
      c.totalDeductions + statutory.reduce((sum, l) => sum + l.amount, 0),
    );
    return {
      ...c,
      totalDeductions,
      net: round2(c.gross - totalDeductions),
      lines: [...c.lines, ...statutory],
    };
  }
}

/** Scales base and fixed earnings; percentage lines follow base automatically. */
function prorate(s: SalaryStructure, factor: number): SalaryStructure {
  if (factor === 1) return s;
  return Object.assign(Object.create(Object.getPrototypeOf(s)), s, {
    baseAmount: s.baseAmount * factor,
    lines: s.lines.map((l) =>
      l.type === LineType.EARNING && l.method === LineMethod.FIXED
        ? { ...l, value: l.value * factor }
        : l,
    ),
  }) as SalaryStructure;
}

function line(code: string, label: string, amount: number): PayslipLine {
  return { code, label, type: LineType.DEDUCTION, amount };
}
