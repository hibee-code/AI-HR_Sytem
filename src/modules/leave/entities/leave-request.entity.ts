import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { numericTransformer } from '../../../common/typeorm/numeric.transformer';
import { Document } from '../../documents/entities/document.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { User } from '../../users/entities/user.entity';
import { LeaveType } from './leave-type.entity';

export enum LeaveRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

/** Half-day marker; only valid when startDate === endDate. */
export enum HalfDay {
  NONE = 'NONE',
  AM = 'AM',
  PM = 'PM',
}

@Entity({ name: 'leave_requests' })
@Index('idx_leave_requests_employee_dates', [
  'employeeId',
  'startDate',
  'endDate',
])
export class LeaveRequest extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'leave_type_id', type: 'uuid' })
  leaveTypeId: string;

  @ManyToOne(() => LeaveType, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'leave_type_id' })
  leaveType: LeaveType;

  @ApiProperty({ example: '2026-12-21' })
  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @ApiProperty({ example: '2026-12-24' })
  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @ApiProperty({ enum: HalfDay })
  @Column({
    name: 'half_day',
    type: 'enum',
    enum: HalfDay,
    enumName: 'half_day',
    default: HalfDay.NONE,
  })
  halfDay: HalfDay;

  /** Working days requested (weekends and public holidays excluded). */
  @ApiProperty({ example: 3.5 })
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 1,
    transformer: numericTransformer,
  })
  days: number;

  /** Calendar year of startDate; requests may not span years. */
  @ApiProperty()
  @Column({ type: 'int' })
  year: number;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  reason: string | null;

  @ApiProperty({ enum: LeaveRequestStatus })
  @Index('idx_leave_requests_status')
  @Column({
    type: 'enum',
    enum: LeaveRequestStatus,
    enumName: 'leave_request_status',
    default: LeaveRequestStatus.PENDING,
  })
  status: LeaveRequestStatus;

  /** Manager's login resolved at submission; null = HR pool. */
  @ApiProperty({ format: 'uuid', nullable: true })
  @Index('idx_leave_requests_approver_user_id')
  @Column({ name: 'approver_user_id', type: 'uuid', nullable: true })
  approverUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approver_user_id' })
  approver: User | null;

  @Column({ name: 'decided_by_user_id', type: 'uuid', nullable: true })
  decidedByUserId: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @ApiProperty({ nullable: true })
  @Column({
    name: 'decision_note',
    type: 'varchar',
    length: 1000,
    nullable: true,
  })
  decisionNote: string | null;

  /** Supporting document, e.g. a medical certificate. */
  @Column({ name: 'attachment_document_id', type: 'uuid', nullable: true })
  attachmentDocumentId: string | null;

  @ManyToOne(() => Document, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'attachment_document_id' })
  attachment: Document | null;

  /** Set when the employee status was switched to ON_LEAVE for this request. */
  @Column({ name: 'status_applied', type: 'boolean', default: false })
  statusApplied: boolean;
}
