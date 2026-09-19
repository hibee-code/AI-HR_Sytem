import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { User } from '../../users/entities/user.entity';
import { ReviewCycle } from './review-cycle.entity';
import { ReviewFeedback } from './review-feedback.entity';

export enum ReviewStatus {
  PENDING_SELF = 'PENDING_SELF',
  PENDING_MANAGER = 'PENDING_MANAGER',
  PENDING_CALIBRATION = 'PENDING_CALIBRATION',
  COMPLETED = 'COMPLETED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
}

/** Free text plus per-competency scores (keys = cycle.competencies). */
export interface Assessment {
  summary: string;
  achievements?: string;
  challenges?: string;
  competencies: Record<string, number>;
}

/** One employee's review within a cycle. */
@Entity({ name: 'reviews' })
@Index('uq_reviews_cycle_employee', ['cycleId', 'employeeId'], { unique: true })
export class Review extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'cycle_id', type: 'uuid' })
  cycleId: string;

  @ManyToOne(() => ReviewCycle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cycle_id' })
  cycle: ReviewCycle;

  @ApiProperty({ format: 'uuid' })
  @Index('idx_reviews_employee_id')
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  /** The manager's login at launch; HR can reassign. Null = HR writes the assessment. */
  @ApiProperty({ format: 'uuid', nullable: true })
  @Index('idx_reviews_reviewer_user_id')
  @Column({ name: 'reviewer_user_id', type: 'uuid', nullable: true })
  reviewerUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewer_user_id' })
  reviewer: User | null;

  @ApiProperty({ enum: ReviewStatus })
  @Column({
    type: 'enum',
    enum: ReviewStatus,
    enumName: 'review_status',
    default: ReviewStatus.PENDING_SELF,
  })
  status: ReviewStatus;

  @ApiProperty({ nullable: true })
  @Column({ name: 'self_assessment', type: 'jsonb', nullable: true })
  selfAssessment: Assessment | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'self_rating', type: 'smallint', nullable: true })
  selfRating: number | null;

  @Column({ name: 'self_submitted_at', type: 'timestamptz', nullable: true })
  selfSubmittedAt: Date | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'manager_assessment', type: 'jsonb', nullable: true })
  managerAssessment: Assessment | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'manager_rating', type: 'smallint', nullable: true })
  managerRating: number | null;

  @Column({ name: 'manager_submitted_at', type: 'timestamptz', nullable: true })
  managerSubmittedAt: Date | null;

  /** Set by calibration or, at close, defaulted from the manager rating. */
  @ApiProperty({ nullable: true })
  @Column({ name: 'final_rating', type: 'smallint', nullable: true })
  finalRating: number | null;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  calibrated: boolean;

  @Column({
    name: 'calibration_note',
    type: 'varchar',
    length: 1000,
    nullable: true,
  })
  calibrationNote: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @ApiProperty({ nullable: true })
  @Column({
    name: 'employee_comment',
    type: 'varchar',
    length: 2000,
    nullable: true,
  })
  employeeComment: string | null;

  @OneToMany(() => ReviewFeedback, (f) => f.review)
  feedback: ReviewFeedback[];
}
