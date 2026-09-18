import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as argon2 from 'argon2';
import type { AuthUser } from '../../common/auth/auth-user.interface';
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
import { ClientMeta, IssuedTokens, TokenService } from './token.service';

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
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly rbac: RbacService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Session ───────────────────────────────────────────────────────────

  async login(
    email: string,
    password: string,
    meta: ClientMeta,
  ): Promise<IssuedTokens> {
    const user = await this.users.findByEmail(email);

    if (!user || !user.passwordHash) {
      await argon2
        .verify(await DUMMY_HASH_PROMISE, password)
        .catch(() => false);
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    this.assertCanLogin(user);

    user.lastLoginAt = new Date();
    await this.users.save(user);
    return this.tokens.issueForLogin(user, meta);
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
      new PasswordChangedEvent(user.id, user.email),
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
