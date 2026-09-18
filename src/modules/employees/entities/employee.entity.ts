import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
} from 'typeorm';
import { SoftDeletableEntity } from '../../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Department } from './department.entity';
import { Position } from './position.entity';

export enum EmployeeStatus {
  /** Hired, pre-start or mid-onboarding checklist. */
  ONBOARDING = 'ONBOARDING',
  ACTIVE = 'ACTIVE',
  /** Extended absence (parental, sabbatical). Short leave does not change status. */
  ON_LEAVE = 'ON_LEAVE',
  TERMINATED = 'TERMINATED',
}

export enum EmploymentType {
  FULL_TIME = 'FULL_TIME',
  PART_TIME = 'PART_TIME',
  CONTRACT = 'CONTRACT',
  INTERN = 'INTERN',
}

export interface PostalAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string; // ISO 3166-1 alpha-2
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
}

/**
 * Serialisation groups: fields tagged FULL are only emitted when the caller
 * may see the complete record (HR, self, or the employee's reporting chain).
 * Everyone else gets the directory view. See EmployeesController.serialise().
 */
export const SERIALIZE_FULL = 'full';

/**
 * The HR record. Linked 0..1 to a login (User). Reporting line is the
 * manager_id chain; department membership is a single FK.
 */
@Entity({ name: 'employees' })
export class Employee extends SoftDeletableEntity {
  @ApiProperty({ format: 'uuid', nullable: true })
  @Expose({ groups: [SERIALIZE_FULL] })
  @Index('uq_employees_user_id', {
    unique: true,
    where: '"user_id" IS NOT NULL',
  })
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @OneToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @ApiProperty({ example: 'EMP-0001' })
  @Index('uq_employees_employee_number', { unique: true })
  @Column({ name: 'employee_number', type: 'varchar', length: 20 })
  employeeNumber: string;

  @ApiProperty()
  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName: string;

  @ApiProperty()
  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName: string;

  @ApiProperty({ example: 'jane.doe@company.com' })
  @Index('uq_employees_work_email', { unique: true })
  @Column({ name: 'work_email', type: 'citext' })
  workEmail: string;

  @ApiProperty({ nullable: true })
  @Expose({ groups: [SERIALIZE_FULL] })
  @Column({ name: 'personal_email', type: 'citext', nullable: true })
  personalEmail: string | null;

  @ApiProperty({ nullable: true })
  @Expose({ groups: [SERIALIZE_FULL] })
  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @ApiProperty({ nullable: true, example: '1990-05-14' })
  @Expose({ groups: [SERIALIZE_FULL] })
  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth: string | null;

  @ApiProperty({ nullable: true })
  @Expose({ groups: [SERIALIZE_FULL] })
  @Column({ type: 'jsonb', nullable: true })
  address: PostalAddress | null;

  @ApiProperty({ nullable: true })
  @Expose({ groups: [SERIALIZE_FULL] })
  @Column({ name: 'emergency_contact', type: 'jsonb', nullable: true })
  emergencyContact: EmergencyContact | null;

  @ApiProperty({ nullable: true })
  @Column({ name: 'photo_url', type: 'varchar', length: 500, nullable: true })
  photoUrl: string | null;

  @ApiProperty({ example: '2026-10-01' })
  @Column({ name: 'hire_date', type: 'date' })
  hireDate: string;

  @ApiProperty({ nullable: true })
  @Expose({ groups: [SERIALIZE_FULL] })
  @Column({ name: 'termination_date', type: 'date', nullable: true })
  terminationDate: string | null;

  @ApiProperty({ enum: EmployeeStatus })
  @Column({
    type: 'enum',
    enum: EmployeeStatus,
    enumName: 'employee_status',
    default: EmployeeStatus.ONBOARDING,
  })
  status: EmployeeStatus;

  @ApiProperty({ enum: EmploymentType })
  @Column({
    name: 'employment_type',
    type: 'enum',
    enum: EmploymentType,
    enumName: 'employment_type',
    default: EmploymentType.FULL_TIME,
  })
  employmentType: EmploymentType;

  @ApiProperty({ format: 'uuid' })
  @Index('idx_employees_department_id')
  @Column({ name: 'department_id', type: 'uuid' })
  departmentId: string;

  @ManyToOne(() => Department, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'position_id', type: 'uuid', nullable: true })
  positionId: string | null;

  @ManyToOne(() => Position, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'position_id' })
  position: Position | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Index('idx_employees_manager_id')
  @Column({ name: 'manager_id', type: 'uuid', nullable: true })
  managerId: string | null;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'manager_id' })
  manager: Employee | null;

  @Expose()
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }
}
