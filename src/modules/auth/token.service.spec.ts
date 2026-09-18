import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import {
  OneTimeToken,
  OneTimeTokenType,
} from './entities/one-time-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { TokenService, parseDuration } from './token.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('parseDuration', () => {
  it.each([
    ['15m', 900_000],
    ['7d', 604_800_000],
    ['30s', 30_000],
    ['2h', 7_200_000],
    ['500ms', 500],
  ])('%s → %d ms', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it('throws on garbage', () => {
    expect(() => parseDuration('soon')).toThrow(/Invalid duration/);
  });
});

describe('TokenService', () => {
  let service: TokenService;
  let refreshRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let oneTimeRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let em: { save: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    em = {
      save: jest.fn(async (_e, r: RefreshToken) => Object.assign(r, { id: 'new-id' })),
      update: jest.fn(),
    };
    refreshRepo = {
      findOne: jest.fn(),
      create: jest.fn((v) => Object.assign(new RefreshToken(), v)),
      update: jest.fn(),
      manager: {
        transaction: jest.fn(async (cb: (e: typeof em) => Promise<void>) =>
          cb(em),
        ),
      },
    };
    oneTimeRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (v) => v),
      create: jest.fn((v) => Object.assign(new OneTimeToken(), v)),
      update: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenService,
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn(async () => 'signed.jwt'),
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                JWT_ACCESS_TTL: '15m',
                JWT_REFRESH_TTL: '7d',
                JWT_ACCESS_SECRET: 'x'.repeat(32),
              })[key],
          },
        },
        { provide: getRepositoryToken(RefreshToken), useValue: refreshRepo },
        { provide: getRepositoryToken(OneTimeToken), useValue: oneTimeRepo },
      ],
    }).compile();

    service = moduleRef.get(TokenService);
  });

  describe('issueForLogin', () => {
    it('stores only a hash of the refresh token and returns the raw one', async () => {
      const tokens = await service.issueForLogin(
        { id: 'u1', email: 'a@b.c' },
        {},
      );

      expect(tokens.accessToken).toBe('signed.jwt');
      expect(tokens.expiresIn).toBe(900);
      expect(tokens.refreshToken).toHaveLength(64); // 48 bytes base64url

      const stored = em.save.mock.calls[0][1] as RefreshToken;
      expect(stored.tokenHash).toBe(sha256(tokens.refreshToken));
      expect(stored.tokenHash).not.toContain(tokens.refreshToken);
      expect(stored.userId).toBe('u1');
      expect(stored.familyId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('rotate', () => {
    const existing = (overrides: Partial<RefreshToken> = {}): RefreshToken =>
      Object.assign(new RefreshToken(), {
        id: 'old-id',
        userId: 'u1',
        familyId: 'fam-1',
        tokenHash: sha256('raw-old'),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user: { id: 'u1', email: 'a@b.c' },
        ...overrides,
      });

    it('rejects unknown tokens', async () => {
      refreshRepo.findOne.mockResolvedValue(null);
      await expect(service.rotate('nope', {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects expired tokens', async () => {
      refreshRepo.findOne.mockResolvedValue(
        existing({ expiresAt: new Date(Date.now() - 1) }),
      );
      await expect(service.rotate('raw-old', {})).rejects.toThrow(/expired/);
    });

    it('issues a successor in the same family and revokes the old one', async () => {
      refreshRepo.findOne.mockResolvedValue(existing());

      const { tokens, userId } = await service.rotate('raw-old', {
        ipAddress: '1.2.3.4',
      });

      expect(userId).toBe('u1');
      expect(tokens.refreshToken).not.toBe('raw-old');
      const stored = em.save.mock.calls[0][1] as RefreshToken;
      expect(stored.familyId).toBe('fam-1');
      expect(em.update).toHaveBeenCalledWith(
        RefreshToken,
        'old-id',
        expect.objectContaining({
          replacedById: 'new-id',
          revokedAt: expect.any(Date),
        }),
      );
    });

    it('on reuse of a revoked token, revokes the whole family', async () => {
      refreshRepo.findOne.mockResolvedValue(
        existing({ revokedAt: new Date() }),
      );

      await expect(service.rotate('raw-old', {})).rejects.toThrow(
        /reuse detected/,
      );

      expect(refreshRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'fam-1' }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      expect(em.save).not.toHaveBeenCalled();
    });
  });

  describe('one-time tokens', () => {
    it('issue invalidates previous unused tokens of the same type', async () => {
      const { raw, expiresAt } = await service.issueOneTime(
        'u1',
        OneTimeTokenType.INVITE,
      );

      expect(oneTimeRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          type: OneTimeTokenType.INVITE,
        }),
        expect.objectContaining({ usedAt: expect.any(Date) }),
      );
      const stored = oneTimeRepo.save.mock.calls[0][0] as OneTimeToken;
      expect(stored.tokenHash).toBe(sha256(raw));
      expect(expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 6 * 24 * 3600 * 1000,
      );
    });

    it('consume burns the token and returns the owner', async () => {
      const token = Object.assign(new OneTimeToken(), {
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 1000),
      });
      oneTimeRepo.findOne.mockResolvedValue(token);

      await expect(
        service.consumeOneTime('raw', OneTimeTokenType.PASSWORD_RESET),
      ).resolves.toBe('u1');
      expect(token.usedAt).toBeInstanceOf(Date);
      expect(oneTimeRepo.save).toHaveBeenCalledWith(token);
    });

    it('consume rejects used or expired tokens', async () => {
      oneTimeRepo.findOne.mockResolvedValue(
        Object.assign(new OneTimeToken(), {
          usedAt: new Date(),
          expiresAt: new Date(Date.now() + 1000),
        }),
      );
      await expect(
        service.consumeOneTime('raw', OneTimeTokenType.INVITE),
      ).rejects.toThrow(UnauthorizedException);

      oneTimeRepo.findOne.mockResolvedValue(
        Object.assign(new OneTimeToken(), {
          usedAt: null,
          expiresAt: new Date(Date.now() - 1),
        }),
      );
      await expect(
        service.consumeOneTime('raw', OneTimeTokenType.INVITE),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
