import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../../../common/typeorm/numeric.transformer';
import { LeaveBalance } from './leave-balance.entity';

/** Append-only audit of HR balance corrections. */
@Entity({ name: 'leave_balance_adjustments' })
export class LeaveBalanceAdjustment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_leave_balance_adjustments_balance_id')
  @Column({ name: 'balance_id', type: 'uuid' })
  balanceId: string;

  @ManyToOne(() => LeaveBalance, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'balance_id' })
  balance: LeaveBalance;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 1,
    transformer: numericTransformer,
  })
  delta: number;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @Column({ name: 'by_user_id', type: 'uuid', nullable: true })
  byUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
