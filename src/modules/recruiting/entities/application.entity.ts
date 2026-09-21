import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Document } from '../../documents/entities/document.entity';
import { Candidate } from './candidate.entity';
import { JobOpening } from './job-opening.entity';

export enum ApplicationStatus {
  APPLIED = 'APPLIED',
  SHORTLISTED = 'SHORTLISTED',
  INTERVIEWING = 'INTERVIEWING',
  OFFERED = 'OFFERED',
  HIRED = 'HIRED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
}

export enum ScreeningStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

/**
 * Output of the AI screener. Always advisory: `aiAssisted` is fixed true so
 * clients can label it, and humans move the application status.
 */
export interface ScreeningResult {
  aiAssisted: true;
  /** 0–100, from the model's requirement-by-requirement assessment. */
  fitScore: number;
  /** Cosine similarity between resume and job description embeddings (0–1). */
  similarity: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  matchedRequirements: string[];
  missingRequirements: string[];
  provider: string;
  model: string;
  screenedAt: string;
}

@Entity({ name: 'applications' })
@Index('uq_applications_opening_candidate', ['openingId', 'candidateId'], {
  unique: true,
})
export class Application extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'opening_id', type: 'uuid' })
  openingId: string;

  @ManyToOne(() => JobOpening, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'opening_id' })
  opening: JobOpening;

  @ApiProperty({ format: 'uuid' })
  @Index('idx_applications_candidate_id')
  @Column({ name: 'candidate_id', type: 'uuid' })
  candidateId: string;

  @ManyToOne(() => Candidate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'candidate_id' })
  candidate: Candidate;

  /** The résumé, stored as a RESUME document restricted to recruiting. */
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'resume_document_id', type: 'uuid' })
  resumeDocumentId: string;

  @ManyToOne(() => Document, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'resume_document_id' })
  resumeDocument: Document;

  @ApiProperty({ enum: ApplicationStatus })
  @Index('idx_applications_status')
  @Column({
    type: 'enum',
    enum: ApplicationStatus,
    enumName: 'application_status',
    default: ApplicationStatus.APPLIED,
  })
  status: ApplicationStatus;

  @ApiProperty({ enum: ScreeningStatus })
  @Column({
    name: 'screening_status',
    type: 'enum',
    enum: ScreeningStatus,
    enumName: 'screening_status',
    default: ScreeningStatus.PENDING,
  })
  screeningStatus: ScreeningStatus;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  @Column({ type: 'jsonb', nullable: true })
  screening: ScreeningResult | null;

  /** Denormalised for ORDER BY; null until screened. */
  @ApiProperty({ nullable: true })
  @Column({ name: 'fit_score', type: 'smallint', nullable: true })
  fitScore: number | null;

  @Column({
    name: 'screening_error',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  screeningError: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'cover_letter', type: 'text', nullable: true })
  coverLetter: string | null;

  /** Recruiter notes; free text. */
  @ApiProperty({ nullable: true })
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'status_changed_by_user_id', type: 'uuid', nullable: true })
  statusChangedByUserId: string | null;
}
