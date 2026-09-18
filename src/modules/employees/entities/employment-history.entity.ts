import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Department } from './department.entity';
import { Employee, EmployeeStatus } from './employee.entity';
import { Position } from './position.entity';

export enum EmploymentChangeType {
  HIRE = 'HIRE',
  PROMOTION = 'PROMOTION',
  TRANSFER = 'TRANSFER',
  MANAGER_CHANGE = 'MANAGER_CHANGE',
  STATUS_CHANGE = 'STATUS_CHANGE',
  TERMINATION = 'TERMINATION',
}

/**
 * Append-only audit of an employee's career: every hire, move, promotion,
 * status change and termination. Written by EmployeesService, never edited.
 * from_* / to_* columns are null when that dimension did not change.
 */
@Entity({ name: 'employment_history' })
export class EmploymentHistory {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Index('idx_employment_history_employee_id')
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @ApiProperty({ enum: EmploymentChangeType })
  @Column({
    name: 'change_type',
    type: 'enum',
    enum: EmploymentChangeType,
    enumName: 'employment_change_type',
  })
  changeType: EmploymentChangeType;

  @ApiProperty({ example: '2026-10-01' })
  @Column({ name: 'effective_date', type: 'date' })
  effectiveDate: string;

  @Column({ name: 'from_department_id', type: 'uuid', nullable: true })
  fromDepartmentId: string | null;

  @ManyToOne(() => Department, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'from_department_id' })
  fromDepartment: Department | null;

  @Column({ name: 'to_department_id', type: 'uuid', nullable: true })
  toDepartmentId: string | null;

  @ManyToOne(() => Department, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'to_department_id' })
  toDepartment: Department | null;

  @Column({ name: 'from_position_id', type: 'uuid', nullable: true })
  fromPositionId: string | null;

  @ManyToOne(() => Position, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'from_position_id' })
  fromPosition: Position | null;

  @Column({ name: 'to_position_id', type: 'uuid', nullable: true })
  toPositionId: string | null;

  @ManyToOne(() => Position, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'to_position_id' })
  toPosition: Position | null;

  @Column({ name: 'from_manager_id', type: 'uuid', nullable: true })
  fromManagerId: string | null;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'from_manager_id' })
  fromManager: Employee | null;

  @Column({ name: 'to_manager_id', type: 'uuid', nullable: true })
  toManagerId: string | null;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'to_manager_id' })
  toManager: Employee | null;

  @Column({
    name: 'from_status',
    type: 'enum',
    enum: EmployeeStatus,
    enumName: 'employee_status',
    nullable: true,
  })
  fromStatus: EmployeeStatus | null;

  @Column({
    name: 'to_status',
    type: 'enum',
    enum: EmployeeStatus,
    enumName: 'employee_status',
    nullable: true,
  })
  toStatus: EmployeeStatus | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  /** The login that made the change; null for system/seed actions. */
  @Column({ name: 'changed_by_user_id', type: 'uuid', nullable: true })
  changedByUserId: string | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
