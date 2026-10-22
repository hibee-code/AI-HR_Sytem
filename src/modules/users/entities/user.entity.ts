import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { Column, Entity, Index, JoinTable, ManyToMany } from 'typeorm';
import { SoftDeletableEntity } from '../../../common/entities/base.entity';
import { Role } from '../../rbac/entities/role.entity';

export enum UserStatus {
  /** Created by HR; has not accepted the invite / set a password yet. */
  INVITED = 'INVITED',
  ACTIVE = 'ACTIVE',
  /** Locked out by an admin. Existing sessions are rejected on next request. */
  SUSPENDED = 'SUSPENDED',
}

/**
 * A login identity. Deliberately separate from the Employee HR record:
 * admins/service accounts need no employee profile, and an employee who
 * never logs in needs no user. Employee.userId links the two (stage 2).
 */
@Entity({ name: 'users' })
export class User extends SoftDeletableEntity {
  @ApiProperty({ example: 'jane@company.com' })
  @Index('uq_users_email', { unique: true })
  @Column({ type: 'citext' })
  email: string;

  /** argon2id hash. Null until the invite is accepted (or for future SSO users). */
  @Exclude()
  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  passwordHash: string | null;

  @ApiProperty()
  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName: string;

  @ApiProperty()
  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName: string;

  @ApiProperty({ enum: UserStatus })
  @Column({
    type: 'enum',
    enum: UserStatus,
    enumName: 'user_status',
    default: UserStatus.INVITED,
  })
  status: UserStatus;

  @ApiProperty({ nullable: true })
  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  /** Access tokens issued before this instant are rejected (see JwtAuthGuard). */
  @Exclude()
  @Column({ name: 'password_changed_at', type: 'timestamptz', nullable: true })
  passwordChangedAt: Date | null;

  // ── MFA (TOTP) & lockout ──────────────────────────────────────────────

  @ApiProperty()
  @Column({ name: 'mfa_enabled', type: 'boolean', default: false })
  mfaEnabled: boolean;

  /** AES-GCM sealed TOTP seed (SecretBox). Set at setup, confirmed by enable. */
  @Exclude()
  @Column({ name: 'mfa_secret', type: 'varchar', length: 255, nullable: true })
  mfaSecret: string | null;

  /** Last accepted TOTP time step; a code can't be replayed. */
  @Exclude()
  @Column({ name: 'mfa_last_step', type: 'bigint', nullable: true })
  mfaLastStep: string | null;

  /** sha256 of unused recovery codes. */
  @Exclude()
  @Column({ name: 'mfa_recovery_codes', type: 'jsonb', default: () => `'[]'` })
  mfaRecoveryCodes: string[];

  @Exclude()
  @Column({ name: 'failed_login_attempts', type: 'int', default: 0 })
  failedLoginAttempts: number;

  @ApiProperty({ nullable: true })
  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @ApiProperty({ type: () => [Role] })
  @ManyToMany(() => Role, { eager: false })
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles: Role[];

  @Expose()
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }
}
