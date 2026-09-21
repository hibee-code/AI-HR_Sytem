import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Department } from '../../employees/entities/department.entity';
import { Position } from '../../employees/entities/position.entity';
import { User } from '../../users/entities/user.entity';

export enum OpeningStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

@Entity({ name: 'job_openings' })
export class JobOpening extends BaseEntity {
  @ApiProperty({ example: 'Senior Backend Engineer' })
  @Column({ type: 'varchar', length: 150 })
  title: string;

  @ApiProperty({ format: 'uuid' })
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

  /** Role summary shown to candidates and used for semantic matching. */
  @ApiProperty()
  @Column({ type: 'text' })
  description: string;

  /** Concrete requirements, one per line; the screener scores against these only. */
  @ApiProperty({ type: [String] })
  @Column({ type: 'jsonb', default: () => `'[]'` })
  requirements: string[];

  @ApiProperty({ enum: OpeningStatus })
  @Index('idx_job_openings_status')
  @Column({
    type: 'enum',
    enum: OpeningStatus,
    enumName: 'opening_status',
    default: OpeningStatus.DRAFT,
  })
  status: OpeningStatus;

  /** Recruiter responsible for the pipeline. */
  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'owner_user_id' })
  owner: User | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;
}
