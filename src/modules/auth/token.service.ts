import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { IsNull, MoreThan, Repository } from 'typeorm';
import type { AccessTokenPayload } from '../../common/auth/auth-user.interface';
import type { Env } from '../../config/env.schema';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants';
import {
  OneTimeToken,
  OneTimeTokenType,
} from './entities/one-time-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** seconds until the access token expires */
  expiresIn: number;
}

/** One signed-in device (a refresh-token family). */
export interface SessionInfo {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
  current: boolean;
}

export interface ClientMeta {
  userAgent?: string;
  ipAddress?: string;
}

/** Window between a correct password and the MFA code. */
export const MFA_CHALLENGE_TTL_SECONDS = 300;

const ONE_TIME_TOKEN_TTL_MS: Record<OneTimeTokenType, number> = {
  [OneTimeTokenType.INVITE]: 7 * 24 * 60 * 60 * 1000,
  [OneTimeTokenType.PASSWORD_RESET]: 60 * 60 * 1000,
};

/**
 * Owns every token the auth module issues:
 *  - access JWTs (short-lived, stateless)
 *  - refresh tokens (opaque, hashed at rest, rotated with reuse detection)
 *  - one-time tokens for invites and password resets
 */
@Injectable()
export class TokenService {
  private readonly refreshTtlMs: number;
  private readonly accessTtlSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(OneTimeToken)
    private readonly oneTimeTokens: Repository<OneTimeToken>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.refreshTtlMs = parseDuration(
      config.get('JWT_REFRESH_TTL', { infer: true }),
    );
    this.accessTtlSeconds = Math.floor(
      parseDuration(config.get('JWT_ACCESS_TTL', { infer: true })) / 1000,
    );
  }

  // ── Access + refresh pair ─────────────────────────────────────────────

  /** New login: starts a fresh refresh-token family. */
  async issueForLogin(
    user: { id: string; email: string },
    meta: ClientMeta,
  ): Promise<IssuedTokens> {
    return this.issuePair(user, randomUUID(), meta);
  }

  /**
   * Rotation. Looks up the presented token; on success revokes it and issues
   * a successor in the same family. A revoked token being replayed means the
   * chain leaked — the entire family is revoked.
   */
  async rotate(
    rawRefreshToken: string,
    meta: ClientMeta,
  ): Promise<{ tokens: IssuedTokens; userId: string }> {
    const existing = await this.refreshTokens.findOne({
      where: { tokenHash: hash(rawRefreshToken) },
      relations: { user: true },
    });
    if (!existing) throw new UnauthorizedException('Invalid refresh token');

    if (existing.isRevoked) {
      await this.revokeFamily(existing.familyId);
      throw new UnauthorizedException(
        'Refresh token reuse detected; please log in again',
      );
    }
    if (existing.isExpired)
      throw new UnauthorizedException('Refresh token expired');

    const tokens = await this.issuePair(
      existing.user,
      existing.familyId,
      meta,
      existing,
    );
    return { tokens, userId: existing.userId };
  }

  /** Logout from one device: revoke that token's family. Silently ignores unknown tokens. */
  async revokeByRawToken(rawRefreshToken: string): Promise<void> {
    const existing = await this.refreshTokens.findOne({
      where: { tokenHash: hash(rawRefreshToken) },
    });
    if (existing) await this.revokeFamily(existing.familyId);
  }

  /** Logout everywhere (password change, suspension, "sign out all devices"). */
  async revokeAllForUser(userId: string): Promise<void> {
    const live = await this.refreshTokens.find({
      where: { userId, revokedAt: IsNull() },
      select: { familyId: true },
    });
    await this.refreshTokens.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    await this.denySessions([...new Set(live.map((t) => t.familyId))]);
  }

  /** The user's signed-in devices, newest activity first. */
  async listSessions(
    userId: string,
    currentSid?: string,
  ): Promise<SessionInfo[]> {
    const live = await this.refreshTokens.find({
      where: { userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
    });
    const starts = new Map<string, Date>(
      (
        (await this.refreshTokens.query(
          `SELECT family_id, min(created_at) AS started FROM refresh_tokens
            WHERE user_id = $1 GROUP BY family_id`,
          [userId],
        )) as { family_id: string; started: Date }[]
      ).map((r) => [r.family_id, new Date(r.started)]),
    );
    return live
      .map((t) => ({
        id: t.familyId,
        createdAt: starts.get(t.familyId) ?? t.createdAt,
        lastUsedAt: t.createdAt, // each refresh rotates the token
        expiresAt: t.expiresAt,
        userAgent: t.userAgent,
        ipAddress: t.ipAddress,
        current: t.familyId === currentSid,
      }))
      .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime());
  }

  /** Signs one device out; its access token stops working immediately. */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const owned = await this.refreshTokens.exists({
      where: { userId, familyId: sessionId },
    });
    if (!owned) throw new NotFoundException('Session not found');
    await this.revokeFamily(sessionId);
  }

  /** Access tokens of revoked sessions are refused until they'd expire anyway. */
  async isSessionRevoked(sid: string | undefined): Promise<boolean> {
    return !!sid && (await this.redis.exists(denyKey(sid))) === 1;
  }

  private async denySessions(familyIds: string[]): Promise<void> {
    if (familyIds.length === 0) return;
    const multi = this.redis.multi();
    for (const id of familyIds)
      multi.set(denyKey(id), '1', 'EX', this.accessTtlSeconds);
    await multi.exec();
  }

  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.verifyWith<AccessTokenPayload>(token, [
      this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      this.config.get('JWT_ACCESS_SECRET_PREVIOUS', { infer: true }),
    ]);
  }

  /**
   * Verifies with the current secret, then the previous one (set during a
   * rotation, so tokens issued just before it keep working until expiry).
   */
  private async verifyWith<T extends object>(
    token: string,
    secrets: (string | undefined)[],
  ): Promise<T> {
    let lastError: unknown;
    for (const secret of secrets.filter((s): s is string => !!s)) {
      try {
        return await this.jwt.verifyAsync<T>(token, { secret });
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  // ── MFA challenge (password OK, code pending) ─────────────────────────

  /**
   * Signed with the *refresh* secret and tagged, so it can never pass as an
   * access token (JwtAuthGuard verifies with the access secret).
   */
  issueMfaChallenge(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, typ: 'mfa' },
      {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: MFA_CHALLENGE_TTL_SECONDS,
      },
    );
  }

  async verifyMfaChallenge(token: string): Promise<string> {
    try {
      const p = await this.verifyWith<{ sub: string; typ?: string }>(token, [
        this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        this.config.get('JWT_REFRESH_SECRET_PREVIOUS', { infer: true }),
      ]);
      if (p.typ !== 'mfa') throw new Error('wrong token type');
      return p.sub;
    } catch {
      throw new UnauthorizedException('MFA session expired; log in again');
    }
  }

  private async issuePair(
    user: { id: string; email: string },
    familyId: string,
    meta: ClientMeta,
    predecessor?: RefreshToken,
  ): Promise<IssuedTokens> {
    const raw = randomBytes(48).toString('base64url');
    const record = this.refreshTokens.create({
      userId: user.id,
      tokenHash: hash(raw),
      familyId,
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
      revokedAt: null,
      replacedById: null,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
    });

    await this.refreshTokens.manager.transaction(async (em) => {
      const saved = await em.save(RefreshToken, record);
      if (predecessor) {
        await em.update(RefreshToken, predecessor.id, {
          revokedAt: new Date(),
          replacedById: saved.id,
        });
      }
    });

    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      sid: familyId,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.accessTtlSeconds,
    });

    return { accessToken, refreshToken: raw, expiresIn: this.accessTtlSeconds };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokens.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    await this.denySessions([familyId]);
  }

  // ── One-time tokens ───────────────────────────────────────────────────

  /** Issues a new token and invalidates any unused ones of the same type. */
  async issueOneTime(
    userId: string,
    type: OneTimeTokenType,
  ): Promise<{ raw: string; expiresAt: Date }> {
    await this.oneTimeTokens.update(
      { userId, type, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ONE_TIME_TOKEN_TTL_MS[type]);
    await this.oneTimeTokens.save(
      this.oneTimeTokens.create({
        userId,
        type,
        tokenHash: hash(raw),
        expiresAt,
        usedAt: null,
      }),
    );
    return { raw, expiresAt };
  }

  /** Validates a one-time token without burning it (e.g. to ask for MFA first). */
  async peekOneTime(raw: string, type: OneTimeTokenType): Promise<string> {
    const token = await this.oneTimeTokens.findOne({
      where: { tokenHash: hash(raw), type },
    });
    if (!token || !token.isUsable) {
      throw new UnauthorizedException('Token is invalid or has expired');
    }
    return token.userId;
  }

  /** Validates and burns a one-time token, returning its owner id. */
  async consumeOneTime(raw: string, type: OneTimeTokenType): Promise<string> {
    const token = await this.oneTimeTokens.findOne({
      where: { tokenHash: hash(raw), type },
    });
    if (!token || !token.isUsable) {
      throw new UnauthorizedException('Token is invalid or has expired');
    }
    token.usedAt = new Date();
    await this.oneTimeTokens.save(token);
    return token.userId;
  }
}

function denyKey(sid: string): string {
  return `auth:revoked-session:${sid}`;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** "15m" → 900000. Format is enforced by the env schema. */
export function parseDuration(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const n = Number(match[1]);
  const unit: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return n * unit[match[2]];
}
