import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Append-only record of a security- or compliance-relevant action. Rows are
 * never updated or deleted (a database trigger enforces it). Request bodies
 * are not stored — only explicitly whitelisted fields (see @Audit).
 */
@Entity({ name: 'audit_logs' })
@Index('idx_audit_logs_created_at', ['createdAt'])
@Index('idx_audit_logs_actor', ['actorUserId', 'createdAt'])
@Index('idx_audit_logs_resource', ['resourceType', 'resourceId'])
export class AuditLog {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** null = system action or an unauthenticated attempt (e.g. failed login). */
  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @ApiProperty({ example: 'payroll.run.approve' })
  @Column({ type: 'varchar', length: 100 })
  action: string;

  @ApiProperty({ example: 'payroll_run' })
  @Column({ name: 'resource_type', type: 'varchar', length: 50 })
  resourceType: string;

  @ApiProperty({ nullable: true })
  @Column({ name: 'resource_id', type: 'varchar', length: 100, nullable: true })
  resourceId: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @Column({ type: 'jsonb', default: () => `'{}'` })
  metadata: Record<string, unknown>;
}
