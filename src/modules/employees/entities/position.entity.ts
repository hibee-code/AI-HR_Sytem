import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Department } from './department.entity';

/** A job title. Optionally scoped to a department; null = company-wide. */
@Entity({ name: 'positions' })
export class Position extends BaseEntity {
  @ApiProperty({ example: 'Senior Backend Engineer' })
  @Column({ type: 'varchar', length: 100 })
  title: string;

  /** Free-form seniority band, e.g. "L4", "Senior", "Director". */
  @ApiProperty({ nullable: true, example: 'L4' })
  @Column({ type: 'varchar', length: 50, nullable: true })
  level: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @ManyToOne(() => Department, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_id' })
  department: Department | null;

  /** Inactive positions can't be assigned but stay for history. */
  @ApiProperty()
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
