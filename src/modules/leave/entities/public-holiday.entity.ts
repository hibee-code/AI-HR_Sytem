import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

/** Non-working days excluded from leave day counts. */
@Entity({ name: 'public_holidays' })
export class PublicHoliday extends BaseEntity {
  @ApiProperty({ example: '2026-12-25' })
  @Index('uq_public_holidays_date', { unique: true })
  @Column({ type: 'date' })
  date: string;

  @ApiProperty({ example: 'Christmas Day' })
  @Column({ type: 'varchar', length: 100 })
  name: string;
}
