import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { numericTransformer } from '../../../common/typeorm/numeric.transformer';
import { Document } from '../../documents/entities/document.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { PayrollRun } from './payroll-run.entity';
import { LineType, SalaryStructure } from './salary-structure.entity';

export interface PayslipLine {
  code: string;
  label: string;
  type: LineType;
  amount: number;
}

const money = {
  type: 'numeric' as const,
  precision: 14,
  scale: 2,
  transformer: numericTransformer,
};

/** Frozen result of a run for one employee. Never recalculated after approval. */
@Entity({ name: 'payslips' })
@Index('uq_payslips_run_employee', ['runId', 'employeeId'], { unique: true })
export class Payslip extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @ManyToOne(() => PayrollRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: PayrollRun;

  @ApiProperty({ format: 'uuid' })
  @Index('idx_payslips_employee_id')
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @Column({ name: 'structure_id', type: 'uuid', nullable: true })
  structureId: string | null;

  @ManyToOne(() => SalaryStructure, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'structure_id' })
  structure: SalaryStructure | null;

  @ApiProperty({ example: 'NGN' })
  @Column({ type: 'char', length: 3 })
  currency: string;

  @ApiProperty() @Column({ name: 'base_amount', ...money }) baseAmount: number;
  @ApiProperty() @Column({ ...money }) gross: number;
  @ApiProperty()
  @Column({ name: 'total_deductions', ...money })
  totalDeductions: number;
  @ApiProperty() @Column({ ...money }) net: number;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  @Column({ type: 'jsonb', default: () => `'[]'` })
  lines: PayslipLine[];

  /** PDF stored as a RESTRICTED PAYSLIP document once the run is approved. */
  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'document_id', type: 'uuid', nullable: true })
  documentId: string | null;

  @ManyToOne(() => Document, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'document_id' })
  document: Document | null;
}
