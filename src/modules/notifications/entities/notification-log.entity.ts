import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Template data are flat primitives; keeps TypeORM's deep-partial typing happy. */
export type JsonPayload = Record<string, string | number | boolean | null>;

export enum NotificationChannel {
  EMAIL = 'EMAIL',
  SLACK = 'SLACK',
}

export enum NotificationStatus {
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  FAILED = 'FAILED',
  /** Deliberately not sent: channel disabled by the user or not configured. */
  SKIPPED = 'SKIPPED',
}

/**
 * One row per (message, channel). Written when the job is enqueued and
 * updated by the worker. `dedupe_key` makes re-emitted events idempotent.
 * `payload` is the template's data — never tokens or secrets.
 */
@Entity({ name: 'notification_log' })
export class NotificationLog {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: NotificationChannel })
  @Column({
    type: 'enum',
    enum: NotificationChannel,
    enumName: 'notification_channel',
  })
  channel: NotificationChannel;

  @ApiProperty({ example: 'USER_INVITED' })
  @Column({ type: 'varchar', length: 50 })
  template: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Index('idx_notification_log_recipient_user_id')
  @Column({ name: 'recipient_user_id', type: 'uuid', nullable: true })
  recipientUserId: string | null;

  /** Resolved address: email, or Slack user/channel id. Null until resolved. */
  @ApiProperty({ nullable: true })
  @Column({
    name: 'recipient_address',
    type: 'varchar',
    length: 254,
    nullable: true,
  })
  recipientAddress: string | null;

  @ApiProperty({ enum: NotificationStatus })
  @Index('idx_notification_log_status')
  @Column({
    type: 'enum',
    enum: NotificationStatus,
    enumName: 'notification_status',
    default: NotificationStatus.QUEUED,
  })
  status: NotificationStatus;

  @Index('uq_notification_log_dedupe_key', {
    unique: true,
    where: '"dedupe_key" IS NOT NULL',
  })
  @Column({ name: 'dedupe_key', type: 'varchar', length: 200, nullable: true })
  dedupeKey: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: JsonPayload;

  @Column({ name: 'job_id', type: 'varchar', length: 100, nullable: true })
  jobId: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  error: string | null;

  /** Provider reference: SMTP message id / Slack ts. */
  @Column({
    name: 'provider_ref',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  providerRef: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
