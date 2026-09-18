import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import type { AccessTokenPayload } from '../../common/auth/auth-user.interface';
import type { Env } from '../../config/env.schema';
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

export interface ClientMeta {
  userAgent?: string;
  ipAddress?: string;
}

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
    await this.refreshTokens.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
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

    const payload: AccessTokenPayload = { sub: user.id, email: user.email };
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
