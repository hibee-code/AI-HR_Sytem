import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { AssigneeRule } from './checklist-template.entity';
import { Checklist } from './checklist.entity';

export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  SKIPPED = 'SKIPPED',
}

export const OPEN_TASK_STATUSES = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];

@Entity({ name: 'checklist_tasks' })
export class ChecklistTask extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Index('idx_checklist_tasks_checklist_id')
  @Column({ name: 'checklist_id', type: 'uuid' })
  checklistId: string;

  @ManyToOne(() => Checklist, (c) => c.tasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'checklist_id' })
  checklist: Checklist;

  @Column({ name: 'template_item_id', type: 'uuid', nullable: true })
  templateItemId: string | null;

  @ApiProperty()
  @Column({ type: 'varchar', length: 200 })
  title: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @ApiProperty({ enum: AssigneeRule })
  @Column({
    name: 'assignee_rule',
    type: 'enum',
    enum: AssigneeRule,
    enumName: 'assignee_rule',
  })
  assigneeRule: AssigneeRule;

  /** Resolved at instantiation (or by reassignment). Null for role-based tasks. */
  @ApiProperty({ format: 'uuid', nullable: true })
  @Index('idx_checklist_tasks_assignee_user_id')
  @Column({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignee_user_id' })
  assignee: User | null;

  @ApiProperty({ nullable: true })
  @Column({
    name: 'assignee_role_name',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  assigneeRoleName: string | null;

  @ApiProperty({ example: '2026-10-03' })
  @Index('idx_checklist_tasks_due_date')
  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @ApiProperty({ enum: TaskStatus })
  @Column({
    type: 'enum',
    enum: TaskStatus,
    enumName: 'task_status',
    default: TaskStatus.PENDING,
  })
  status: TaskStatus;

  @ApiProperty()
  @Column({ name: 'is_required', type: 'boolean', default: true })
  isRequired: boolean;

  @ApiProperty()
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  /** Filled in by the documents module (stage 6); no FK yet. */
  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'document_id', type: 'uuid', nullable: true })
  documentId: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'completed_by_user_id', type: 'uuid', nullable: true })
  completedByUserId: string | null;

  @Column({ name: 'last_reminded_at', type: 'timestamptz', nullable: true })
  lastRemindedAt: Date | null;
}
