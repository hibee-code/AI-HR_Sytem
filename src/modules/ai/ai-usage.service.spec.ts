import type { ConfigService } from '@nestjs/config';
import type { Logger } from 'nestjs-pino';
import type { Repository } from 'typeorm';
import type { RbacService } from '../rbac/rbac.service';
import { AiUsageService } from './ai-usage.service';
import type { AiUsage } from './entities/ai-usage.entity';

describe('AiUsageService daily limits', () => {
  const make = (roles: string[], used = 0) => {
    const env: Record<string, unknown> = {
      AI_DAILY_MESSAGE_LIMIT: 50,
      AI_DAILY_LIMIT_OVERRIDES: { HR_MANAGER: 200, RECRUITER: 120, ADMIN: 0 },
    };
    return new AiUsageService(
      { count: jest.fn(async () => used) } as unknown as Repository<AiUsage>,
      {
        getAuthUser: jest.fn(async () => ({ roles })),
      } as unknown as RbacService,
      {} as Logger,
      { get: (k: string) => env[k] } as unknown as ConfigService<never, true>,
    );
  };

  it('uses the default without an override', async () => {
    await expect(make(['EMPLOYEE']).limitFor('u')).resolves.toBe(50);
  });

  it('takes the most generous override across roles; 0 = unlimited wins', async () => {
    await expect(
      make(['EMPLOYEE', 'RECRUITER', 'HR_MANAGER']).limitFor('u'),
    ).resolves.toBe(200);
    await expect(make(['HR_MANAGER', 'ADMIN']).limitFor('u')).resolves.toBe(0);
  });

  it('refuses at the cap with AI_DAILY_LIMIT, never when unlimited', async () => {
    await expect(
      make(['EMPLOYEE'], 50).assertWithinDailyLimit('u'),
    ).rejects.toMatchObject({
      response: { error: 'AI_DAILY_LIMIT' },
    });
    await expect(
      make(['ADMIN'], 10_000).assertWithinDailyLimit('u'),
    ).resolves.toBeUndefined();
  });
});
