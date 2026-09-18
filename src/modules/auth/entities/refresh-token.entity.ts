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

/**
 * One row per issued refresh token. Tokens are opaque random strings; only a
 * SHA-256 hash is stored. Every login starts a new `familyId`; each refresh
 * revokes the used token and issues a successor in the same family. If a
 * revoked token is ever presented again (theft / replay), the whole family
 * is revoked and the user must log in again.
 */
@Entity({ name: 'refresh_tokens' })
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_refresh_tokens_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index('uq_refresh_tokens_token_hash', { unique: true })
  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash: string;

  @Index('idx_refresh_tokens_family_id')
  @Column({ name: 'family_id', type: 'uuid' })
  familyId: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  /** Set when rotated: the id of the token that superseded this one. */
  @Column({ name: 'replaced_by_id', type: 'uuid', nullable: true })
  replacedById: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  get isExpired(): boolean {
    return this.expiresAt.getTime() <= Date.now();
  }

  get isRevoked(): boolean {
    return this.revokedAt !== null;
  }
}
