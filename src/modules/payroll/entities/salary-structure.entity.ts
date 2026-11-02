import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { encrypted } from '../../../common/security/field-encryption';
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

  // Pay figures are encrypted at rest (FIELD_ENCRYPTION_KEY); they're only
  // ever computed in the app, never summed or filtered in SQL.

  /** Base pay per pay period. */
  @ApiProperty({ example: 850000 })
  @Column({ name: 'base_amount', type: 'text', transformer: encrypted.number })
  baseAmount: number;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  @Column({ type: 'text', transformer: encrypted.json })
  lines: StructureLine[];

  /** Declared annual rent (NGN) for PAYE rent relief; null = none claimed. */
  @ApiProperty({ nullable: true, example: 1_800_000 })
  @Column({
    name: 'annual_rent',
    type: 'text',
    nullable: true,
    transformer: encrypted.number,
  })
  annualRent: number | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;
}
