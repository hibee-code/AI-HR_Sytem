import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

/** A person who applied at least once. Re-applications reuse the row (by email). */
@Entity({ name: 'candidates' })
export class Candidate extends BaseEntity {
  @ApiProperty()
  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName: string;
  @ApiProperty()
  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName: string;

  @ApiProperty({ example: 'ada@example.com' })
  @Index('uq_candidates_email', { unique: true })
  @Column({ type: 'citext' })
  email: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  /** Where the application came from (careers page, referral, agency…). */
  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  source: string | null;

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }
}
