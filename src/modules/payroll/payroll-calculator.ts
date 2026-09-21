import { Injectable } from '@nestjs/common';
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
}

/**
 * Pluggable pay computation. Bind a different implementation to
 * PAYROLL_CALCULATOR to apply real tax tables, statutory contributions, etc.
 */
export interface PayrollCalculator {
  calculate(
    structure: SalaryStructure,
    period: { start: string; end: string },
  ): PayslipComputation;
}

export const PAYROLL_CALCULATOR = Symbol('PAYROLL_CALCULATOR');

export const round2 = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Default: base + earning lines = gross; deduction lines (fixed, % of base,
 * % of gross) subtracted; nothing pro-rated by period. Good enough to stub
 * payroll end-to-end; not a tax engine.
 */
@Injectable()
export class DefaultPayrollCalculator implements PayrollCalculator {
  calculate(
    structure: SalaryStructure,
    _period: { start: string; end: string },
  ): PayslipComputation {
    const base = round2(structure.baseAmount);
    const lines: PayslipLine[] = [
      { code: 'BASE', label: 'Base pay', type: LineType.EARNING, amount: base },
    ];

    const earnings = structure.lines.filter((l) => l.type === LineType.EARNING);
    for (const l of earnings) {
      lines.push({
        code: l.code,
        label: l.label,
        type: LineType.EARNING,
        amount: this.amountFor(l, base, null),
      });
    }
    const gross = round2(lines.reduce((s, l) => s + l.amount, 0));

    let totalDeductions = 0;
    for (const l of structure.lines.filter(
      (x) => x.type === LineType.DEDUCTION,
    )) {
      const amount = this.amountFor(l, base, gross);
      totalDeductions = round2(totalDeductions + amount);
      lines.push({
        code: l.code,
        label: l.label,
        type: LineType.DEDUCTION,
        amount,
      });
    }

    return {
      baseAmount: base,
      gross,
      totalDeductions,
      net: round2(gross - totalDeductions),
      lines,
    };
  }

  private amountFor(
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
}
