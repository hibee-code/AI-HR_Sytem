import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Employee } from '../../employees/entities/employee.entity';

export enum AttendanceSource {
  /** Employee clocked in/out via the API. */
  CLOCK = 'CLOCK',
  /** Entered or corrected by HR. */
  MANUAL = 'MANUAL',
}

/** Longest a session may stay open before the daily job closes it. */
export const MAX_SESSION_HOURS = 16;

/**
 * One work session. Several per day are fine (breaks); only one may be
 * open (clockOut null) per employee at a time. `date` is the calendar day
 * of clockIn (UTC) and drives daily/monthly aggregation.
 */
@Entity({ name: 'attendance_records' })
@Index('idx_attendance_records_employee_date', ['employeeId', 'date'])
export class AttendanceRecord extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @ApiProperty({ example: '2026-10-05' })
  @Column({ type: 'date' })
  date: string;

  @ApiProperty()
  @Column({ name: 'clock_in', type: 'timestamptz' })
  clockIn: Date;

  @ApiProperty({ nullable: true })
  @Index('idx_attendance_records_open', { where: '"clock_out" IS NULL' })
  @Column({ name: 'clock_out', type: 'timestamptz', nullable: true })
  clockOut: Date | null;

  /** Filled in when the session closes. */
  @ApiProperty({ nullable: true })
  @Column({ name: 'worked_minutes', type: 'int', nullable: true })
  workedMinutes: number | null;

  @ApiProperty({ enum: AttendanceSource })
  @Column({
    type: 'enum',
    enum: AttendanceSource,
    enumName: 'attendance_source',
    default: AttendanceSource.CLOCK,
  })
  source: AttendanceSource;

  /** True when the daily job closed a forgotten session at the max length. */
  @ApiProperty()
  @Column({ name: 'auto_closed', type: 'boolean', default: false })
  autoClosed: boolean;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  get isOpen(): boolean {
    return this.clockOut === null;
  }
}
