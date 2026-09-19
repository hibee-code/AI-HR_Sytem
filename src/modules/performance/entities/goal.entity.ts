import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { ReviewCycle } from './review-cycle.entity';

export enum GoalStatus {
  /** Proposed by the employee, awaiting manager approval. */
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Entity({ name: 'goals' })
export class Goal extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Index('idx_goals_employee_id')
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  /** Optional: ties the goal to a review period. */
  @ApiProperty({ format: 'uuid', nullable: true })
  @Index('idx_goals_cycle_id')
  @Column({ name: 'cycle_id', type: 'uuid', nullable: true })
  cycleId: string | null;

  @ManyToOne(() => ReviewCycle, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'cycle_id' })
  cycle: ReviewCycle | null;

  @ApiProperty({ example: 'Ship the billing service' })
  @Column({ type: 'varchar', length: 200 })
  title: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 2000, nullable: true })
  description: string | null;

  /** Relative importance in percent; an employee's active goals should sum to ≤ 100. */
  @ApiProperty({ example: 30 })
  @Column({ type: 'int', default: 0 })
  weight: number;

  @ApiProperty({ enum: GoalStatus })
  @Column({
    type: 'enum',
    enum: GoalStatus,
    enumName: 'goal_status',
    default: GoalStatus.DRAFT,
  })
  status: GoalStatus;

  @ApiProperty({ example: 40, description: '0–100' })
  @Column({ type: 'int', default: 0 })
  progress: number;

  @ApiProperty({ nullable: true })
  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId: string | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;
}
