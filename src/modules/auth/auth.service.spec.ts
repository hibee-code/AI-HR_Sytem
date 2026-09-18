import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { RbacService } from '../rbac/rbac.service';
import { User, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AUTH_EVENTS } from './auth.events';
import { AuthService } from './auth.service';
import { OneTimeTokenType } from './entities/one-time-token.entity';
import { TokenService } from './token.service';

describe('AuthService', () => {
  let service: AuthService;
  let users: jest.Mocked<
    Pick<UsersService, 'findByEmail' | 'findById' | 'save' | 'createInvited'>
  >;
  let tokens: jest.Mocked<
    Pick<
      TokenService,
      | 'issueForLogin'
      | 'rotate'
      | 'revokeAllForUser'
      | 'issueOneTime'
      | 'consumeOneTime'
    >
  >;
  let rbac: jest.Mocked<
    Pick<RbacService, 'getAuthUser' | 'invalidateAuthUser'>
  >;
  let events: { emit: jest.Mock };

  const PASSWORD = 'correct-horse-9';
  let activeUser: User;

  beforeAll(async () => {
    activeUser = Object.assign(new User(), {
      id: 'u1',
      email: 'jane@x.io',
      firstName: 'Jane',
      status: UserStatus.ACTIVE,
      passwordHash: await argon2.hash(PASSWORD),
      passwordChangedAt: null,
    });
  });

  beforeEach(async () => {
    users = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      save: jest.fn(async (u) => u),
      createInvited: jest.fn(),
    };
    tokens = {
      issueForLogin: jest.fn().mockResolvedValue({
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 900,
      }),
      rotate: jest.fn(),
      revokeAllForUser: jest.fn(),
      issueOneTime: jest
        .fn()
        .mockResolvedValue({ raw: 'one-time-raw', expiresAt: new Date() }),
      consumeOneTime: jest.fn(),
    };
    rbac = { getAuthUser: jest.fn(), invalidateAuthUser: jest.fn() };
    events = { emit: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: TokenService, useValue: tokens },
        { provide: RbacService, useValue: rbac },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('issues tokens and records lastLoginAt on valid credentials', async () => {
      const u = Object.assign(new User(), activeUser);
      users.findByEmail.mockResolvedValue(u);

      const result = await service.login('jane@x.io', PASSWORD, {});

      expect(result.accessToken).toBe('a');
      expect(u.lastLoginAt).toBeInstanceOf(Date);
      expect(tokens.issueForLogin).toHaveBeenCalledWith(u, {});
    });

    it('rejects wrong password with a generic message', async () => {
      users.findByEmail.mockResolvedValue(
        Object.assign(new User(), activeUser),
      );
      await expect(service.login('jane@x.io', 'wrong', {})).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('rejects unknown email with the same generic message', async () => {
      users.findByEmail.mockResolvedValue(null);
      await expect(service.login('ghost@x.io', PASSWORD, {})).rejects.toThrow(
        'Invalid email or password',
      );
      expect(tokens.issueForLogin).not.toHaveBeenCalled();
    });

    it('rejects suspended users even with the right password', async () => {
      users.findByEmail.mockResolvedValue(
        Object.assign(new User(), activeUser, { status: UserStatus.SUSPENDED }),
      );
      await expect(service.login('jane@x.io', PASSWORD, {})).rejects.toThrow(
        /suspended/,
      );
    });

    it('rejects invited users who have no password yet', async () => {
      users.findByEmail.mockResolvedValue(
        Object.assign(new User(), activeUser, {
          status: UserStatus.INVITED,
          passwordHash: null,
        }),
      );
      await expect(service.login('jane@x.io', PASSWORD, {})).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refresh', () => {
    it('revokes everything if the user was suspended after the token was issued', async () => {
      tokens.rotate.mockResolvedValue({
        tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 900 },
        userId: 'u1',
      });
      rbac.getAuthUser.mockResolvedValue({
        id: 'u1',
        email: 'jane@x.io',
        status: UserStatus.SUSPENDED,
        roles: [],
        permissions: [],
        passwordChangedAt: null,
      });

      await expect(service.refresh('r', {})).rejects.toThrow(/not active/);
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u1');
    });
  });

  describe('invite → accept', () => {
    it('creates the user and emits the invite token via event (never returns it)', async () => {
      const invited = Object.assign(new User(), {
        id: 'u2',
        email: 'new@x.io',
        firstName: 'New',
      });
      users.createInvited.mockResolvedValue(invited);

      const result = await service.invite({
        email: 'new@x.io',
        firstName: 'New',
        lastName: 'Hire',
        roles: ['EMPLOYEE'],
      });

      expect(result).toBe(invited);
      expect(tokens.issueOneTime).toHaveBeenCalledWith(
        'u2',
        OneTimeTokenType.INVITE,
      );
      expect(events.emit).toHaveBeenCalledWith(
        AUTH_EVENTS.USER_INVITED,
        expect.objectContaining({ userId: 'u2', inviteToken: 'one-time-raw' }),
      );
      expect(JSON.stringify(result)).not.toContain('one-time-raw');
    });

    it('accept sets an argon2id hash, activates, and starts a session', async () => {
      const invited = Object.assign(new User(), {
        id: 'u2',
        email: 'new@x.io',
        status: UserStatus.INVITED,
        passwordHash: null,
      });
      tokens.consumeOneTime.mockResolvedValue('u2');
      users.findById.mockResolvedValue(invited);

      await service.acceptInvite('tok', 'NewPassw0rd!', {});

      expect(invited.status).toBe(UserStatus.ACTIVE);
      expect(invited.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await argon2.verify(invited.passwordHash!, 'NewPassw0rd!')).toBe(
        true,
      );
      expect(rbac.invalidateAuthUser).toHaveBeenCalledWith('u2');
      expect(tokens.issueForLogin).toHaveBeenCalled();
    });

    it('accept refuses if the user is already active (token replay after activation)', async () => {
      tokens.consumeOneTime.mockResolvedValue('u1');
      users.findById.mockResolvedValue(Object.assign(new User(), activeUser));
      await expect(
        service.acceptInvite('tok', 'NewPassw0rd!', {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('password reset', () => {
    it('forgot-password stays silent for unknown or inactive emails', async () => {
      users.findByEmail.mockResolvedValue(null);
      await expect(
        service.requestPasswordReset('ghost@x.io'),
      ).resolves.toBeUndefined();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('reset changes the hash, revokes all sessions and busts the cache', async () => {
      const u = Object.assign(new User(), activeUser);
      tokens.consumeOneTime.mockResolvedValue('u1');
      users.findById.mockResolvedValue(u);

      await service.resetPassword('tok', 'Another-Pass1');

      expect(await argon2.verify(u.passwordHash!, 'Another-Pass1')).toBe(true);
      expect(u.passwordChangedAt).toBeInstanceOf(Date);
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u1');
      expect(rbac.invalidateAuthUser).toHaveBeenCalledWith('u1');
      expect(events.emit).toHaveBeenCalledWith(
        AUTH_EVENTS.PASSWORD_CHANGED,
        expect.anything(),
      );
    });

    it('change-password requires the current password', async () => {
      users.findById.mockResolvedValue(Object.assign(new User(), activeUser));
      await expect(
        service.changePassword('u1', 'wrong', 'Another-Pass1'),
      ).rejects.toThrow(/Current password is incorrect/);
      expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});
