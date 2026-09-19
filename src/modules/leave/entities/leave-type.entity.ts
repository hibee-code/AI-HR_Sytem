import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { numericTransformer } from '../../../common/typeorm/numeric.transformer';

/**
 * A kind of leave and its policy. Balances are provisioned from
 * `defaultDays` (pro-rated in the hire year) and carried over per the
 * carry-over settings. Types with `requiresBalance = false` (e.g. unpaid)
 * are unlimited and never touch balances.
 */
@Entity({ name: 'leave_types' })
export class LeaveType extends BaseEntity {
  @ApiProperty({ example: 'ANNUAL' })
  @Index('uq_leave_types_code', { unique: true })
  @Column({ type: 'varchar', length: 30 })
  code: string;

  @ApiProperty({ example: 'Annual leave' })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  /** Yearly entitlement in working days (0.5 steps). */
  @ApiProperty({ example: 20 })
  @Column({
    name: 'default_days',
    type: 'numeric',
    precision: 5,
    scale: 1,
    default: 0,
    transformer: numericTransformer,
  })
  defaultDays: number;

  @ApiProperty()
  @Column({ name: 'is_paid', type: 'boolean', default: true })
  isPaid: boolean;

  @ApiProperty({ description: 'false = unlimited, no balance tracking' })
  @Column({ name: 'requires_balance', type: 'boolean', default: true })
  requiresBalance: boolean;

  @ApiProperty({
    example: 5,
    description: 'Max unused days carried into the next year',
  })
  @Column({
    name: 'carry_over_max_days',
    type: 'numeric',
    precision: 5,
    scale: 1,
    default: 0,
    transformer: numericTransformer,
  })
  carryOverMaxDays: number;

  /** "MM-DD" after which carried-over days expire; null = never. */
  @ApiProperty({ nullable: true, example: '03-31' })
  @Column({
    name: 'carry_over_expires_on',
    type: 'varchar',
    length: 5,
    nullable: true,
  })
  carryOverExpiresOn: string | null;

  @ApiProperty()
  @Column({ name: 'allow_half_day', type: 'boolean', default: true })
  allowHalfDay: boolean;

  @ApiProperty()
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty()
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
