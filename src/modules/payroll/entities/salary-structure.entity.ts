import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { numericTransformer } from '../../../common/typeorm/numeric.transformer';
import { Employee } from '../../employees/entities/employee.entity';

export enum PayFrequency {
  MONTHLY = 'MONTHLY',
  BIWEEKLY = 'BIWEEKLY',
  WEEKLY = 'WEEKLY',
}

export enum LineType {
  EARNING = 'EARNING',
  DEDUCTION = 'DEDUCTION',
}

export enum LineMethod {
  /** `value` is an amount per pay period. */
  FIXED = 'FIXED',
  /** `value` is a percentage of the base amount. */
  PERCENT_OF_BASE = 'PERCENT_OF_BASE',
  /** `value` is a percentage of total earnings (base + earning lines). Deductions only. */
  PERCENT_OF_GROSS = 'PERCENT_OF_GROSS',
}

export interface StructureLine {
  code: string;
  label: string;
  type: LineType;
  method: LineMethod;
  value: number;
}

/**
 * Effective-dated pay definition for one employee. Creating a new structure
 * closes the previous one (effectiveTo = day before), so history is kept and
 * a run always resolves the structure in force on its period end.
 */
@Entity({ name: 'salary_structures' })
@Index('idx_salary_structures_employee_effective', [
  'employeeId',
  'effectiveFrom',
])
export class SalaryStructure extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @ApiProperty({ example: '2026-01-01' })
  @Column({ name: 'effective_from', type: 'date' })
  effectiveFrom: string;

  @ApiProperty({ nullable: true, description: 'null = current' })
  @Column({ name: 'effective_to', type: 'date', nullable: true })
  effectiveTo: string | null;

  @ApiProperty({ example: 'NGN' })
  @Column({ type: 'char', length: 3 })
  currency: string;

  @ApiProperty({ enum: PayFrequency })
  @Column({
    name: 'pay_frequency',
    type: 'enum',
    enum: PayFrequency,
    enumName: 'pay_frequency',
    default: PayFrequency.MONTHLY,
  })
  payFrequency: PayFrequency;

  /** Base pay per pay period. */
  @ApiProperty({ example: 850000 })
  @Column({
    name: 'base_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  baseAmount: number;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  @Column({ type: 'jsonb', default: () => `'[]'` })
  lines: StructureLine[];

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;
}
