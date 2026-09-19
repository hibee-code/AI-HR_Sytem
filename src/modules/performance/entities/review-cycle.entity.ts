import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Department } from '../../employees/entities/department.entity';

export enum CyclePhase {
  DRAFT = 'DRAFT',
  SELF_REVIEW = 'SELF_REVIEW',
  MANAGER_REVIEW = 'MANAGER_REVIEW',
  CALIBRATION = 'CALIBRATION',
  CLOSED = 'CLOSED',
}

export const PHASE_ORDER: CyclePhase[] = [
  CyclePhase.DRAFT,
  CyclePhase.SELF_REVIEW,
  CyclePhase.MANAGER_REVIEW,
  CyclePhase.CALIBRATION,
  CyclePhase.CLOSED,
];

export interface RatingLevel {
  value: number;
  label: string;
}

export const DEFAULT_RATING_SCALE: RatingLevel[] = [
  { value: 1, label: 'Needs improvement' },
  { value: 2, label: 'Developing' },
  { value: 3, label: 'Meets expectations' },
  { value: 4, label: 'Exceeds expectations' },
  { value: 5, label: 'Exceptional' },
];

/**
 * A review period. Launching it creates one Review per in-scope employee;
 * phases only move forward. The rating scale is stored per cycle so labels
 * can be tuned without a schema change.
 */
@Entity({ name: 'review_cycles' })
export class ReviewCycle extends BaseEntity {
  @ApiProperty({ example: 'H2 2026' })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @ApiProperty({ example: '2026-07-01' })
  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @ApiProperty({ example: '2026-12-31' })
  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @ApiProperty({ enum: CyclePhase })
  @Index('idx_review_cycles_phase')
  @Column({
    type: 'enum',
    enum: CyclePhase,
    enumName: 'cycle_phase',
    default: CyclePhase.DRAFT,
  })
  phase: CyclePhase;

  @ApiProperty({ example: '2027-01-15' })
  @Column({ name: 'self_review_deadline', type: 'date' })
  selfReviewDeadline: string;

  @ApiProperty({ example: '2027-01-31' })
  @Column({ name: 'manager_review_deadline', type: 'date' })
  managerReviewDeadline: string;

  /** Restrict to one department (and its sub-departments); null = whole company. */
  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @ManyToOne(() => Department, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_id' })
  department: Department | null;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  @Column({
    name: 'rating_scale',
    type: 'jsonb',
    default: () => `'${JSON.stringify(DEFAULT_RATING_SCALE)}'`,
  })
  ratingScale: RatingLevel[];

  /** Competencies every review scores, e.g. ["Ownership", "Collaboration"]. */
  @ApiProperty({ type: [String] })
  @Column({ type: 'jsonb', default: () => `'[]'` })
  competencies: string[];

  @Column({ name: 'launched_at', type: 'timestamptz', nullable: true })
  launchedAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  get maxRating(): number {
    return Math.max(...this.ratingScale.map((r) => r.value));
  }
}
