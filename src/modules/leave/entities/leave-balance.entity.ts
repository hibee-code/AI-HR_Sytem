import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { numericTransformer } from '../../../common/typeorm/numeric.transformer';
import { Employee } from '../../employees/entities/employee.entity';
import { LeaveType } from './leave-type.entity';

const days = {
  type: 'numeric' as const,
  precision: 5,
  scale: 1,
  default: 0,
  transformer: numericTransformer,
};

/**
 * One row per employee × leave type × calendar year, provisioned lazily.
 * available = entitled + carriedOver (until expiry) + adjustment − used − pending
 */
@Entity({ name: 'leave_balances' })
@Index(
  'uq_leave_balances_employee_type_year',
  ['employeeId', 'leaveTypeId', 'year'],
  { unique: true },
)
export class LeaveBalance extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'leave_type_id', type: 'uuid' })
  leaveTypeId: string;

  @ManyToOne(() => LeaveType, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leave_type_id' })
  leaveType: LeaveType;

  @ApiProperty({ example: 2026 })
  @Column({ type: 'int' })
  year: number;

  @ApiProperty() @Column({ ...days }) entitled: number;
  @ApiProperty() @Column({ name: 'carried_over', ...days }) carriedOver: number;

  @ApiProperty({ nullable: true })
  @Column({ name: 'carry_over_expires_on', type: 'date', nullable: true })
  carryOverExpiresOn: string | null;

  /** HR manual corrections (positive or negative); audited in leave_balance_adjustments. */
  @ApiProperty() @Column({ ...days }) adjustment: number;
  @ApiProperty() @Column({ ...days }) used: number;
  /** Reserved by PENDING requests. */
  @ApiProperty() @Column({ ...days }) pending: number;

  /** Carried-over days still usable on `asOf` (default today). */
  effectiveCarryOver(
    asOf: string = new Date().toISOString().slice(0, 10),
  ): number {
    if (this.carryOverExpiresOn && asOf > this.carryOverExpiresOn) return 0;
    return this.carriedOver;
  }

  available(asOf?: string): number {
    return round1(
      this.entitled +
        this.effectiveCarryOver(asOf) +
        this.adjustment -
        this.used -
        this.pending,
    );
  }
}

export function round1(n: number): number {
  return Math.round(n * 2) / 2; // half-day resolution
}
