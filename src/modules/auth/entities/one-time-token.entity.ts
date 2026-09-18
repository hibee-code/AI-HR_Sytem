import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum OneTimeTokenType {
  INVITE = 'INVITE',
  PASSWORD_RESET = 'PASSWORD_RESET',
}

/**
 * Single-use, short-lived tokens delivered out of band (email). Only the
 * SHA-256 hash is stored. Issuing a new token of the same type for a user
 * invalidates the previous unused ones.
 */
@Entity({ name: 'one_time_tokens' })
export class OneTimeToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_one_time_tokens_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: OneTimeTokenType,
    enumName: 'one_time_token_type',
  })
  type: OneTimeTokenType;

  @Index('uq_one_time_tokens_token_hash', { unique: true })
  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  get isUsable(): boolean {
    return this.usedAt === null && this.expiresAt.getTime() > Date.now();
  }
}
