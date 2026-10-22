import { Injectable } from '@nestjs/common';
import { daysBetween } from '../../common/utils/date';
import type { PayslipLine } from './entities/payslip.entity';
import { LineType, PayFrequency } from './entities/salary-structure.entity';
import {
  contractualPay,
  Employment,
  PayrollCalculator,
  PayslipComputation,
  PaySegment,
  Period,
  round2,
  YearToDate,
} from './payroll-calculator';

export { prorationFactor } from './payroll-calculator';

/**
 * Statutory parameters in one place. Finance must confirm these before each
 * tax year — they are configuration, not business logic.
 *
 *  - PAYE: Nigeria Tax Act 2025 personal income tax bands (annual, NGN),
 *    effective 1 January 2026. The first ₦800,000 is tax-free.
 *  - Pension: Pension Reform Act 2014 — employee 8% of basic + housing +
 *    transport (the employer's 10% is a cost, not a payslip deduction).
 *  - NHF: National Housing Fund Act — 2.5% of basic salary.
 *  - Employer costs (not deducted): pension 10% of the same pensionable pay;
 *    NSITF (Employee Compensation Act) 1% of gross. ITF (1% of annual
 *    payroll) is an annual levy and is not computed per payslip.
 *  - Reliefs (NTA 2025): pension, NHF, NHIS, life-assurance premiums and
 *    mortgage interest on an owner-occupied home reduce taxable pay; rent
 *    relief is 20% of declared annual rent, capped at ₦500,000.
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
  pensionEmployerRate: 0.1,
  nsitfRate: 0.01,
  /** Earning line codes that count as pensionable alongside basic. */
  pensionableCodes: ['HOUSING', 'TRANSPORT'],
  nhfRate: 0.025,
  /** Deduction line codes that also reduce taxable pay. */
  taxDeductibleCodes: ['NHIS', 'LIFE_ASSURANCE', 'MORTGAGE_INTEREST'],
  rentReliefRate: 0.2,
  rentReliefCap: 500_000,
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

/**
 * Cumulative PAYE. Projects the year's taxable pay (year-to-date + this
 * period × the periods left), taxes it, takes the share of that tax earned
 * so far and subtracts what was already deducted. Steady pay gives exactly
 * annual tax ÷ periods; pay changes and mid-year joiners self-correct on
 * an actual-year basis. Over-deduction is never refunded via payroll (min 0).
 *
 * Without history (first run, or go-live mid-year) pay since 1 January or
 * the hire date is assumed to have been at this period's rate.
 */
export function cumulativePaye(input: {
  taxableThisPeriod: number;
  ytd?: YearToDate;
  /** Periods in the year before this one while employed (used without history). */
  periodsBefore: number;
  /** Periods left in the tax year after this one. */
  periodsAfter: number;
  annualRelief: number;
}): number {
  const t = input.taxableThisPeriod;
  const hasHistory = (input.ytd?.periods ?? 0) > 0;
  const ytdTaxable = hasHistory ? input.ytd!.taxable : t * input.periodsBefore;
  const projected = ytdTaxable + t * (1 + input.periodsAfter);
  if (projected <= 0) return 0;
  const annualTax = annualPaye(Math.max(0, projected - input.annualRelief));
  const dueToDate = (annualTax * (ytdTaxable + t)) / projected;
  const alreadyPaid = hasHistory
    ? input.ytd!.paye
    : (annualTax * ytdTaxable) / projected;
  return round2(Math.max(0, dueToDate - alreadyPaid));
}

/** Whole pay periods between two dates at this frequency. */
function periodsBetween(from: string, to: string, f: PayFrequency): number {
  if (to <= from) return 0;
  return Math.round(daysBetween(from, to) / (365 / PERIODS_PER_YEAR[f]));
}

/**
 * Contractual pay (the default calculator) pro-rated for joiners/leavers,
 * plus Nigerian statutory deductions: employee pension, NHF and cumulative
 * PAYE on taxable pay (gross − pension − NHF − NHIS / life assurance /
 * mortgage interest), with rent relief. Non-NGN structures get contractual
 * pay only.
 */
@Injectable()
export class NigeriaPayrollCalculator implements PayrollCalculator {
  calculate(
    segments: PaySegment[],
    period: Period,
    employment?: Employment,
    ytd?: YearToDate,
  ): PayslipComputation {
    const c = contractualPay(segments, period, employment);
    // Frequency, declared rent and currency come from the structure in force at period end.
    const structure = segments[segments.length - 1].structure;
    if (structure.currency !== 'NGN' || c.employedFraction === 0) return c;

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
    const reliefLines = c.lines
      .filter(
        (l) =>
          l.type === LineType.DEDUCTION &&
          (S.taxDeductibleCodes as readonly string[]).includes(
            l.code.toUpperCase(),
          ),
      )
      .reduce((sum, l) => sum + l.amount, 0);
    const taxableAmount = round2(
      Math.max(0, c.gross - pension - nhf - reliefLines),
    );

    const year = period.end.slice(0, 4);
    const from =
      employment && employment.hireDate > `${year}-01-01`
        ? employment.hireDate
        : `${year}-01-01`;
    const f = structure.payFrequency;
    const paye =
      own(...OWN_CODES.PAYE) ??
      cumulativePaye({
        taxableThisPeriod: taxableAmount,
        ytd,
        periodsBefore: periodsBetween(from, period.start, f),
        periodsAfter: periodsBetween(period.end, `${year}-12-31`, f),
        annualRelief: Math.min(
          (structure.annualRent ?? 0) * S.rentReliefRate,
          S.rentReliefCap,
        ),
      });

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
      taxableAmount,
      employerCosts: [
        {
          code: 'PENSION_EMPLOYER',
          label: 'Employer pension (10%)',
          amount: round2(pensionable * S.pensionEmployerRate),
        },
        {
          code: 'NSITF',
          label: 'NSITF (1% of gross)',
          amount: round2(c.gross * S.nsitfRate),
        },
      ],
    };
  }
}

function line(code: string, label: string, amount: number): PayslipLine {
  return { code, label, type: LineType.DEDUCTION, amount };
}
