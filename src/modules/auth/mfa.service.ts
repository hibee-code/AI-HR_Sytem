import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { SecretBox } from '../../common/security/secret-box';
import {
  generateTotpSecret,
  otpauthUrl,
  verifyTotp,
} from '../../common/security/totp';
import type { Env } from '../../config/env.schema';
import { RbacService } from '../rbac/rbac.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

const RECOVERY_CODE_COUNT = 10;

/**
 * TOTP enrolment and verification. A user's seed is stored sealed
 * (SecretBox); recovery codes are stored as sha256 and are single-use.
 */
@Injectable()
export class MfaService {
  private readonly box: SecretBox;
  private readonly requiredRoles: Set<string>;
  private readonly issuer: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly users: UsersService,
    private readonly rbac: RbacService,
  ) {
    this.box = new SecretBox(config.get('MFA_ENCRYPTION_KEY', { infer: true }));
    this.requiredRoles = new Set(
      config.get('MFA_REQUIRED_ROLES', { infer: true }),
    );
    this.issuer = config.get('APP_NAME', { infer: true });
  }

  /** Whether any of these roles must have MFA before using the API. */
  isRequiredFor(roles: string[]): boolean {
    return roles.some((r) => this.requiredRoles.has(r));
  }

  /** Step 1: new (pending) seed. Re-running replaces an unconfirmed one. */
  async beginSetup(
    userId: string,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.users.findById(userId);
    if (user.mfaEnabled)
      throw new BadRequestException('MFA is already enabled');
    const secret = generateTotpSecret();
    user.mfaSecret = this.box.encrypt(secret);
    await this.users.save(user);
    return { secret, otpauthUrl: otpauthUrl(secret, user.email, this.issuer) };
  }

  /** Step 2: confirm with a code from the app; returns one-time recovery codes. */
  async enable(
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.users.findById(userId);
    if (user.mfaEnabled)
      throw new BadRequestException('MFA is already enabled');
    if (!user.mfaSecret) throw new BadRequestException('Start MFA setup first');
    const step = verifyTotp(this.box.decrypt(user.mfaSecret), code);
    if (step === null) throw new BadRequestException('Invalid code');

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      randomBytes(5)
        .toString('hex')
        .replace(/^(.{5})/, '$1-'),
    );
    user.mfaEnabled = true;
    user.mfaLastStep = String(step);
    user.mfaRecoveryCodes = recoveryCodes.map(hashCode);
    await this.save(user);
    return { recoveryCodes };
  }

  /** Self-service off switch; refused where the role makes MFA mandatory. */
  async disable(userId: string, code: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user.mfaEnabled) throw new BadRequestException('MFA is not enabled');
    if (this.isRequiredFor(user.roles.map((r) => r.name)))
      throw new BadRequestException('MFA is mandatory for your role');
    if (!(await this.verify(user, code)))
      throw new BadRequestException('Invalid code');
    await this.clear(user);
  }

  /** Admin recovery when a user loses their device. */
  async reset(userId: string): Promise<void> {
    await this.clear(await this.users.findById(userId));
  }

  /**
   * Accepts a 6-digit TOTP (not previously used) or an unused recovery code,
   * consuming it. Returns false on mismatch.
   */
  async verify(user: User, code: string): Promise<boolean> {
    if (!user.mfaEnabled || !user.mfaSecret) return false;
    const normalised = code.replace(/\s/g, '').toLowerCase();

    if (/^\d{6}$/.test(normalised)) {
      const step = verifyTotp(this.box.decrypt(user.mfaSecret), normalised);
      if (step === null || step <= Number(user.mfaLastStep ?? -1)) return false;
      user.mfaLastStep = String(step);
      await this.users.save(user);
      return true;
    }

    const hashed = hashCode(normalised);
    if (!user.mfaRecoveryCodes.includes(hashed)) return false;
    user.mfaRecoveryCodes = user.mfaRecoveryCodes.filter((h) => h !== hashed);
    await this.users.save(user);
    return true;
  }

  private async clear(user: User): Promise<void> {
    user.mfaEnabled = false;
    user.mfaSecret = null;
    user.mfaLastStep = null;
    user.mfaRecoveryCodes = [];
    await this.save(user);
  }

  private async save(user: User): Promise<void> {
    await this.users.save(user);
    await this.rbac.invalidateAuthUser(user.id); // guard reads mfaEnabled
  }
}

function hashCode(code: string): string {
  return createHash('sha256')
    .update(code.replace(/-/g, '').toLowerCase())
    .digest('hex');
}
