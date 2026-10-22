import { Injectable } from '@nestjs/common';
import { daysBetween } from '../../common/utils/date';
import type { PayslipLine } from './entities/payslip.entity';
import {
  LineMethod,
  LineType,
  SalaryStructure,
} from './entities/salary-structure.entity';

export interface PayslipComputation {
  baseAmount: number;
  gross: number;
  totalDeductions: number;
  net: number;
  lines: PayslipLine[];
  /** Share of the period actually employed (0 = nothing due). */
  employedFraction: number;
  /** Taxable pay this period (statutory calculators only); feeds year-to-date PAYE. */
  taxableAmount?: number;
  /** Employer-side costs (not deducted from pay), e.g. employer pension, NSITF. */
  employerCosts: { code: string; label: string; amount: number }[];
}

/** Employment dates within which pay is due (for pro-rating). */
export interface Employment {
  hireDate: string;
  terminationDate: string | null;
}

export interface Period {
  start: string;
  end: string;
}

/**
 * The days of a period paid under one salary structure. A structure change
 * mid-period yields two segments, each paid for its own days.
 */
export interface PaySegment {
  structure: SalaryStructure;
  start: string;
  end: string;
}

export interface YearToDate {
  taxable: number;
  paye: number;
  periods: number;
}

/**
 * Pluggable pay computation, selected by PAYROLL_CALCULATOR:
 * `nigeria` (statutory deductions) or `simple` (contractual lines only).
 * Segments are in date order and all in the run's currency.
 */
export interface PayrollCalculator {
  calculate(
    segments: PaySegment[],
    period: Period,
    employment?: Employment,
    ytd?: YearToDate,
  ): PayslipComputation;
}

export const PAYROLL_CALCULATOR = Symbol('PAYROLL_CALCULATOR');

export const round2 = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/** One structure covering the whole period (the common case, and tests). */
export function wholePeriod(
  structure: SalaryStructure,
  period: Period,
): PaySegment[] {
  return [{ structure, start: period.start, end: period.end }];
}

/** Share of the period the person was employed (calendar days). */
export function prorationFactor(
  period: Period,
  employment?: Employment,
): number {
  return (
    employedDays(period.start, period.end, employment) /
    (daysBetween(period.start, period.end) + 1)
  );
}

/** Calendar days of [start, end] that fall inside employment. */
function employedDays(
  start: string,
  end: string,
  employment?: Employment,
): number {
  const from =
    employment && employment.hireDate > start ? employment.hireDate : start;
  const to =
    employment?.terminationDate && employment.terminationDate < end
      ? employment.terminationDate
      : end;
  return to < from ? 0 : daysBetween(from, to) + 1;
}

/**
 * Contractual pay for the period: each segment's structure is paid for the
 * share of the period it covers (and the person was employed), then the
 * lines are merged by code. Base and FIXED earnings scale with that share;
 * percentage lines follow; deductions are computed per segment.
 */
export function contractualPay(
  segments: PaySegment[],
  period: Period,
  employment?: Employment,
): PayslipComputation {
  const periodDays = daysBetween(period.start, period.end) + 1;
  const merged = new Map<string, PayslipLine>();
  let base = 0;
  let fraction = 0;

  for (const seg of segments) {
    const share = employedDays(seg.start, seg.end, employment) / periodDays;
    if (share === 0) continue;
    fraction += share;
    const c = structureLines(prorate(seg.structure, share));
    base += c.base;
    for (const l of c.lines) {
      const key = `${l.type}:${l.code}`;
      const prev = merged.get(key);
      merged.set(key, {
        ...l, // latest segment's label wins
        amount: round2((prev?.amount ?? 0) + l.amount),
      });
    }
  }

  const lines = [...merged.values()];
  const baseLine = lines.find((l) => l.code === 'BASE');
  if (baseLine) {
    if (segments.length > 1)
      baseLine.label = `Base pay (rate changed ${segments[1].start})`;
    else if (fraction < 1)
      baseLine.label = `Base pay (pro-rated ${Math.round(fraction * 100)}%)`;
  }
  const sum = (t: LineType) =>
    round2(lines.filter((l) => l.type === t).reduce((s, l) => s + l.amount, 0));
  const gross = sum(LineType.EARNING);
  const totalDeductions = sum(LineType.DEDUCTION);
  return {
    baseAmount: round2(base),
    gross,
    totalDeductions,
    net: round2(gross - totalDeductions),
    lines,
    employedFraction: Math.min(1, fraction),
    employerCosts: [],
  };
}

/** `simple`: contractual lines only — no tax engine. */
@Injectable()
export class DefaultPayrollCalculator implements PayrollCalculator {
  calculate(
    segments: PaySegment[],
    period: Period,
    employment?: Employment,
  ): PayslipComputation {
    return contractualPay(segments, period, employment);
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

/** Base + earning lines, then deductions (fixed, % of base, % of gross). */
function structureLines(structure: SalaryStructure): {
  base: number;
  lines: PayslipLine[];
} {
  const base = round2(structure.baseAmount);
  const lines: PayslipLine[] = [
    { code: 'BASE', label: 'Base pay', type: LineType.EARNING, amount: base },
  ];
  for (const l of structure.lines.filter((x) => x.type === LineType.EARNING)) {
    lines.push({
      code: l.code,
      label: l.label,
      type: LineType.EARNING,
      amount: amountFor(l, base, null),
    });
  }
  const gross = round2(lines.reduce((s, l) => s + l.amount, 0));
  for (const l of structure.lines.filter(
    (x) => x.type === LineType.DEDUCTION,
  )) {
    lines.push({
      code: l.code,
      label: l.label,
      type: LineType.DEDUCTION,
      amount: amountFor(l, base, gross),
    });
  }
  return { base, lines };
}

function amountFor(
  line: SalaryStructure['lines'][number],
  base: number,
  gross: number | null,
): number {
  switch (line.method) {
    case LineMethod.FIXED:
      return round2(line.value);
    case LineMethod.PERCENT_OF_BASE:
      return round2((base * line.value) / 100);
    case LineMethod.PERCENT_OF_GROSS:
      if (gross === null)
        throw new Error(
          `${line.code}: PERCENT_OF_GROSS is only valid for deductions`,
        );
      return round2((gross * line.value) / 100);
  }
}
