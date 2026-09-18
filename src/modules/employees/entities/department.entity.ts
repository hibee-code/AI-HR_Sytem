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
import { Employee } from './employee.entity';

/**
 * Adjacency-list tree (parent_id). Departments are few, so the org tree is
 * assembled in memory rather than via a closure table.
 */
@Entity({ name: 'departments' })
export class Department extends BaseEntity {
  @ApiProperty({ example: 'Engineering' })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Short stable identifier, e.g. ENG, HR, FIN. */
  @ApiProperty({ example: 'ENG' })
  @Index('uq_departments_code', { unique: true })
  @Column({ type: 'varchar', length: 20 })
  code: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => Department, (d) => d.children, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parent_id' })
  parent: Department | null;

  @OneToMany(() => Department, (d) => d.parent)
  children: Department[];

  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'head_employee_id', type: 'uuid', nullable: true })
  headEmployeeId: string | null;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'head_employee_id' })
  head: Employee | null;
}
