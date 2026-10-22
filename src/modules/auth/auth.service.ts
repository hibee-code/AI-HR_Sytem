import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as argon2 from 'argon2';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import type { Env } from '../../config/env.schema';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { User, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import {
  AUTH_EVENTS,
  PasswordChangedEvent,
  PasswordResetRequestedEvent,
  UserInvitedEvent,
} from './auth.events';
import { OneTimeTokenType } from './entities/one-time-token.entity';
import { MfaService } from './mfa.service';
import {
  ClientMeta,
  IssuedTokens,
  MFA_CHALLENGE_TTL_SECONDS,
  TokenService,
} from './token.service';

/** Either a session, or a challenge to finish with POST /auth/mfa/verify. */
export type LoginResult =
  | ({ mfaRequired: false } & IssuedTokens)
  | { mfaRequired: true; mfaToken: string; expiresIn: number };

const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP 2024 minimum recommendation
  timeCost: 2,
  parallelism: 1,
};

/** Constant-cost dummy so login timing doesn't reveal whether an email exists. */
const DUMMY_HASH_PROMISE = argon2.hash(
  'dummy-password-for-timing',
  ARGON2_OPTIONS,
);

@Injectable()
export class AuthService {
  private readonly maxAttempts: number;
  private readonly lockMinutes: number;

  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly rbac: RbacService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    config: ConfigService<Env, true>,
  ) {
    this.maxAttempts = config.get('LOGIN_MAX_ATTEMPTS', { infer: true });
    this.lockMinutes = config.get('LOGIN_LOCKOUT_MINUTES', { infer: true });
  }

  // ── Session ───────────────────────────────────────────────────────────

  async login(
    email: string,
    password: string,
    meta: ClientMeta,
  ): Promise<LoginResult> {
    const user = await this.users.findByEmail(email);

    if (!user || !user.passwordHash) {
      await argon2
        .verify(await DUMMY_HASH_PROMISE, password)
        .catch(() => false);
      await this.auditAuth('auth.login_failed', null, meta, {
        email,
        reason: 'unknown_user',
      });
      throw new UnauthorizedException('Invalid email or password');
    }
    this.assertNotLocked(user);
    if (!(await argon2.verify(user.passwordHash, password))) {
      await this.registerFailure(user, meta, 'password');
      throw new UnauthorizedException('Invalid email or password');
    }
    this.assertCanLogin(user);

    if (user.mfaEnabled) {
      return {
        mfaRequired: true,
        mfaToken: await this.tokens.issueMfaChallenge(user.id),
        expiresIn: MFA_CHALLENGE_TTL_SECONDS,
      };
    }
    return this.completeLogin(user, meta);
  }

  /** Second factor: TOTP or recovery code against the challenge from login. */
  async verifyMfa(
    mfaToken: string,
    code: string,
    meta: ClientMeta,
  ): Promise<LoginResult> {
    const user = await this.users.findById(
      await this.tokens.verifyMfaChallenge(mfaToken),
    );
    this.assertNotLocked(user);
    this.assertCanLogin(user);
    if (!(await this.mfa.verify(user, code))) {
      await this.registerFailure(user, meta, 'mfa');
      throw new UnauthorizedException('Invalid authentication code');
    }
    return this.completeLogin(user, meta);
  }

  async refresh(
    rawRefreshToken: string,
    meta: ClientMeta,
  ): Promise<IssuedTokens> {
    const { tokens, userId } = await this.tokens.rotate(rawRefreshToken, meta);
    // Suspension after the refresh token was issued must still lock the user out.
    const ctx = await this.rbac.getAuthUser(userId);
    if (!ctx || ctx.status !== UserStatus.ACTIVE) {
      await this.tokens.revokeAllForUser(userId);
      throw new UnauthorizedException('Account is not active');
    }
    return tokens;
  }

  logout(rawRefreshToken: string): Promise<void> {
    return this.tokens.revokeByRawToken(rawRefreshToken);
  }

  logoutAll(userId: string): Promise<void> {
    return this.tokens.revokeAllForUser(userId);
  }

  me(user: AuthUser): Promise<User> {
    return this.users.findById(user.id);
  }

  // ── Invite ────────────────────────────────────────────────────────────

  async invite(input: {
    email: string;
    firstName: string;
    lastName: string;
    roles: string[];
  }): Promise<User> {
    const user = await this.users.createInvited(input);
    await this.sendInvite(user);
    return user;
  }

  /** Re-issues the invite for a user who hasn't accepted yet. */
  async resendInvite(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (user.status !== UserStatus.INVITED) {
      throw new BadRequestException('User has already accepted their invite');
    }
    await this.sendInvite(user);
  }

  async acceptInvite(
    rawToken: string,
    password: string,
    meta: ClientMeta,
  ): Promise<IssuedTokens> {
    const userId = await this.tokens.consumeOneTime(
      rawToken,
      OneTimeTokenType.INVITE,
    );
    const user = await this.users.findById(userId);
    if (user.status !== UserStatus.INVITED) {
      throw new BadRequestException('Invite has already been accepted');
    }
    user.passwordHash = await this.hashPassword(password);
    user.passwordChangedAt = new Date();
    user.status = UserStatus.ACTIVE;
    user.lastLoginAt = new Date();
    await this.users.save(user);
    await this.rbac.invalidateAuthUser(user.id);
    return this.tokens.issueForLogin(user, meta);
  }

  // ── Password lifecycle ────────────────────────────────────────────────

  /** Always resolves, so callers can't probe which emails exist. */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== UserStatus.ACTIVE) return;
    const { raw, expiresAt } = await this.tokens.issueOneTime(
      user.id,
      OneTimeTokenType.PASSWORD_RESET,
    );
    this.events.emit(
      AUTH_EVENTS.PASSWORD_RESET_REQUESTED,
      new PasswordResetRequestedEvent(
        user.id,
        user.email,
        user.firstName,
        raw,
        expiresAt,
      ),
    );
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const userId = await this.tokens.consumeOneTime(
      rawToken,
      OneTimeTokenType.PASSWORD_RESET,
    );
    const user = await this.users.findById(userId);
    this.assertCanLogin(user);
    await this.applyNewPassword(user, newPassword);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (
      !user.passwordHash ||
      !(await argon2.verify(user.passwordHash, currentPassword))
    ) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'New password must differ from the current one',
      );
    }
    await this.applyNewPassword(user, newPassword);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async completeLogin(
    user: User,
    meta: ClientMeta,
  ): Promise<LoginResult> {
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await this.users.save(user);
    await this.auditAuth('auth.login', user.id, meta, {
      mfa: user.mfaEnabled,
    });
    return {
      mfaRequired: false,
      ...(await this.tokens.issueForLogin(user, meta)),
    };
  }

  private async registerFailure(
    user: User,
    meta: ClientMeta,
    reason: 'password' | 'mfa',
  ): Promise<void> {
    await this.auditAuth('auth.login_failed', user.id, meta, { reason });
    const lockedUntil = await this.users.recordFailedLogin(
      user.id,
      this.maxAttempts,
      this.lockMinutes,
    );
    if (lockedUntil) {
      await this.auditAuth('auth.locked', user.id, meta, {
        lockedUntil: lockedUntil.toISOString(),
      });
    }
  }

  private assertNotLocked(user: User): void {
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60_000,
      );
      throw new HttpException(
        {
          error: 'ACCOUNT_LOCKED',
          message: `Too many failed attempts. Try again in ${minutes} minute(s) or ask an administrator to unlock the account.`,
        },
        HttpStatus.LOCKED,
      );
    }
  }

  private auditAuth(
    action: string,
    userId: string | null,
    meta: ClientMeta,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      actorUserId: userId,
      action,
      resourceType: 'user',
      resourceId: userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata,
    });
  }

  private async sendInvite(user: User): Promise<void> {
    const { raw, expiresAt } = await this.tokens.issueOneTime(
      user.id,
      OneTimeTokenType.INVITE,
    );
    this.events.emit(
      AUTH_EVENTS.USER_INVITED,
      new UserInvitedEvent(user.id, user.email, user.firstName, raw, expiresAt),
    );
  }

  private async applyNewPassword(
    user: User,
    newPassword: string,
  ): Promise<void> {
    user.passwordHash = await this.hashPassword(newPassword);
    user.passwordChangedAt = new Date();
    await this.users.save(user);
    // Every other session is now stale; access tokens die via passwordChangedAt check.
    await this.tokens.revokeAllForUser(user.id);
    await this.rbac.invalidateAuthUser(user.id);
    this.events.emit(
      AUTH_EVENTS.PASSWORD_CHANGED,
      new PasswordChangedEvent(user.id, user.email, user.firstName),
    );
  }

  private hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  private assertCanLogin(user: User): void {
    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Account is suspended');
    }
    if (user.status === UserStatus.INVITED) {
      throw new UnauthorizedException(
        'Accept your invitation to activate the account',
      );
    }
  }
}
