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
import { Department } from '../../employees/entities/department.entity';
import { ChecklistTemplateItem } from './checklist-template-item.entity';

export enum ChecklistType {
  ONBOARDING = 'ONBOARDING',
  OFFBOARDING = 'OFFBOARDING',
}

/** Who a task is assigned to when a checklist is instantiated. */
export enum AssigneeRule {
  /** The employee being on/offboarded (their login). */
  EMPLOYEE = 'EMPLOYEE',
  /** The employee's manager (their login). */
  MANAGER = 'MANAGER',
  /** Anyone holding the HR_MANAGER role. */
  HR = 'HR',
  /** Anyone holding the role named in `assigneeRoleName` (e.g. IT_SUPPORT). */
  ROLE = 'ROLE',
}

/**
 * HR-defined blueprint. The most specific active template wins when a
 * checklist starts: department-specific, then company-wide (department null).
 */
@Entity({ name: 'checklist_templates' })
export class ChecklistTemplate extends BaseEntity {
  @ApiProperty({ example: 'Engineering onboarding' })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @ApiProperty({ enum: ChecklistType })
  @Index('idx_checklist_templates_type')
  @Column({ type: 'enum', enum: ChecklistType, enumName: 'checklist_type' })
  type: ChecklistType;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'null = company-wide default',
  })
  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @ManyToOne(() => Department, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'department_id' })
  department: Department | null;

  @ApiProperty()
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => ChecklistTemplateItem, (i) => i.template, {
    cascade: ['insert'],
  })
  items: ChecklistTemplateItem[];
}
