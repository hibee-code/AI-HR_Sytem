import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Review } from './review.entity';

export enum FeedbackStatus {
  REQUESTED = 'REQUESTED',
  SUBMITTED = 'SUBMITTED',
  DECLINED = 'DECLINED',
}

export interface FeedbackAnswers {
  strengths: string;
  improvements: string;
  rating?: number;
}

/** Peer / 360 feedback attached to a review. Shown to the employee only after the cycle closes, anonymised. */
@Entity({ name: 'review_feedback' })
@Index('uq_review_feedback_review_giver', ['reviewId', 'giverUserId'], {
  unique: true,
})
export class ReviewFeedback extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'review_id', type: 'uuid' })
  reviewId: string;

  @ManyToOne(() => Review, (r) => r.feedback, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'review_id' })
  review: Review;

  @Column({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId: string | null;

  @ApiProperty({ format: 'uuid' })
  @Index('idx_review_feedback_giver_user_id')
  @Column({ name: 'giver_user_id', type: 'uuid' })
  giverUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'giver_user_id' })
  giver: User;

  @ApiProperty({ enum: FeedbackStatus })
  @Column({
    type: 'enum',
    enum: FeedbackStatus,
    enumName: 'feedback_status',
    default: FeedbackStatus.REQUESTED,
  })
  status: FeedbackStatus;

  @Column({ type: 'jsonb', nullable: true })
  answers: FeedbackAnswers | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;
}
