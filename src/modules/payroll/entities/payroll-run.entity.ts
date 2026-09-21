import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Department } from '../../employees/entities/department.entity';

export enum PayrollRunStatus {
  DRAFT = 'DRAFT',
  CALCULATED = 'CALCULATED',
  APPROVED = 'APPROVED',
  PAID = 'PAID',
}

export interface RunTotals {
  employees: number;
  gross: number;
  deductions: number;
  net: number;
  /** Employees in scope with no salary structure on the period end. */
  skipped: number;
}

@Entity({ name: 'payroll_runs' })
export class PayrollRun extends BaseEntity {
  @ApiProperty({ example: '2026-10-01' })
  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @ApiProperty({ example: '2026-10-31' })
  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @ApiProperty({ example: '2026-10-28' })
  @Column({ name: 'pay_date', type: 'date' })
  payDate: string;

  @ApiProperty({ enum: PayrollRunStatus })
  @Index('idx_payroll_runs_status')
  @Column({
    type: 'enum',
    enum: PayrollRunStatus,
    enumName: 'payroll_run_status',
    default: PayrollRunStatus.DRAFT,
  })
  status: PayrollRunStatus;

  /** Optional scope; null = whole company. */
  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @ManyToOne(() => Department, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_id' })
  department: Department | null;

  @ApiProperty({ example: 'NGN' })
  @Column({ type: 'char', length: 3 })
  currency: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @Column({ type: 'jsonb', default: () => `'{}'` })
  totals: Partial<RunTotals>;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;
}
