import type { ConfigService } from '@nestjs/config';
import { base32Decode, totpCode, totpStep } from '../../common/security/totp';
import type { RbacService } from '../rbac/rbac.service';
import { User, UserStatus } from '../users/entities/user.entity';
import type { UsersService } from '../users/users.service';
import { MfaService } from './mfa.service';

describe('MfaService', () => {
  let user: User;
  let service: MfaService;
  const rbac = { invalidateAuthUser: jest.fn() };

  beforeEach(() => {
    user = Object.assign(new User(), {
      id: 'u1',
      email: 'jane@x.io',
      status: UserStatus.ACTIVE,
      roles: [{ name: 'EMPLOYEE' }],
      mfaEnabled: false,
      mfaSecret: null,
      mfaLastStep: null,
      mfaRecoveryCodes: [],
    });
    const users = {
      findById: jest.fn(async () => user),
      save: jest.fn(async (u: User) => u),
    };
    const env: Record<string, unknown> = {
      MFA_ENCRYPTION_KEY: 'k'.repeat(32),
      MFA_REQUIRED_ROLES: ['ADMIN'],
      APP_NAME: 'HR System',
    };
    service = new MfaService(
      { get: (k: string) => env[k] } as unknown as ConfigService<never, true>,
      users as unknown as UsersService,
      rbac as unknown as RbacService,
    );
  });

  async function enrol() {
    const { secret, otpauthUrl } = await service.beginSetup('u1');
    expect(base32Decode(secret)).toHaveLength(20);
    expect(otpauthUrl).toContain('otpauth://totp/HR%20System%3Ajane%40x.io');
    expect(user.mfaSecret).not.toContain(secret); // sealed at rest
    const { recoveryCodes } = await service.enable(
      'u1',
      totpCode(secret, totpStep()),
    );
    return { secret, recoveryCodes };
  }

  it('enrols with a valid code and returns 10 single-use recovery codes', async () => {
    const { recoveryCodes } = await enrol();
    expect(user.mfaEnabled).toBe(true);
    expect(recoveryCodes).toHaveLength(10);
    expect(recoveryCodes[0]).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
    expect(user.mfaRecoveryCodes).not.toContain(recoveryCodes[0]); // hashed
    expect(rbac.invalidateAuthUser).toHaveBeenCalledWith('u1');
  });

  it('refuses to enable with a wrong code or without setup', async () => {
    await expect(service.enable('u1', '123456')).rejects.toThrow(/setup/);
    await service.beginSetup('u1');
    await expect(service.enable('u1', '000000')).rejects.toThrow(/Invalid/);
  });

  it('rejects a replayed TOTP code', async () => {
    const { secret } = await enrol();
    const next = totpCode(secret, totpStep() + 1);
    await expect(service.verify(user, next)).resolves.toBe(true);
    await expect(service.verify(user, next)).resolves.toBe(false);
  });

  it('recovery codes work once, with or without the dash', async () => {
    const { recoveryCodes } = await enrol();
    const code = recoveryCodes[3];
    await expect(service.verify(user, code.replace('-', ''))).resolves.toBe(
      true,
    );
    await expect(service.verify(user, code)).resolves.toBe(false);
    expect(user.mfaRecoveryCodes).toHaveLength(9);
  });

  it('cannot be disabled where the role makes it mandatory', async () => {
    const { secret } = await enrol();
    user.roles = [{ name: 'ADMIN' }] as User['roles'];
    await expect(
      service.disable('u1', totpCode(secret, totpStep() + 1)),
    ).rejects.toThrow(/mandatory/);
    expect(service.isRequiredFor(['EMPLOYEE'])).toBe(false);
    expect(service.isRequiredFor(['EMPLOYEE', 'ADMIN'])).toBe(true);
  });

  it('reset clears everything', async () => {
    await enrol();
    await service.reset('u1');
    expect(user).toMatchObject({
      mfaEnabled: false,
      mfaSecret: null,
      mfaRecoveryCodes: [],
    });
  });
});
