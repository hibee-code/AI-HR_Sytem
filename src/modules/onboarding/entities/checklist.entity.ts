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
import { ChecklistTask } from './checklist-task.entity';
import { ChecklistTemplate, ChecklistType } from './checklist-template.entity';

export enum ChecklistStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/** A template instantiated for one employee. Tasks are copied, not referenced. */
@Entity({ name: 'checklists' })
export class Checklist extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Index('idx_checklists_employee_id')
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'template_id', type: 'uuid', nullable: true })
  templateId: string | null;

  @ManyToOne(() => ChecklistTemplate, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'template_id' })
  template: ChecklistTemplate | null;

  @ApiProperty({ enum: ChecklistType })
  @Column({ type: 'enum', enum: ChecklistType, enumName: 'checklist_type' })
  type: ChecklistType;

  @ApiProperty({ enum: ChecklistStatus })
  @Index('idx_checklists_status')
  @Column({
    type: 'enum',
    enum: ChecklistStatus,
    enumName: 'checklist_status',
    default: ChecklistStatus.IN_PROGRESS,
  })
  status: ChecklistStatus;

  /** Hire date (onboarding) or last day (offboarding); task due dates are relative to it. */
  @ApiProperty({ example: '2026-10-01' })
  @Column({ name: 'anchor_date', type: 'date' })
  anchorDate: string;

  @ApiProperty({ nullable: true })
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @OneToMany(() => ChecklistTask, (t) => t.checklist, { cascade: ['insert'] })
  tasks: ChecklistTask[];
}
