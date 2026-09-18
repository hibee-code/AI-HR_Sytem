import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AUTH_EVENTS, UserInvitedEvent } from '../src/modules/auth/auth.events';
import { ADMIN, createTestApp, destroyTestApp } from './utils/test-app';

const BASE = '/api/v1';

describe('Auth & RBAC (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => request.Agent;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    http = () => request(app.getHttpServer());
  });

  afterAll(() => destroyTestApp(app, ds));

  const login = async (email = ADMIN.email, password = ADMIN.password) => {
    const res = await http()
      .post(`${BASE}/auth/login`)
      .send({ email, password })
      .expect(200);
    return res.body as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    };
  };

  describe('login', () => {
    it('returns a token pair for valid credentials', async () => {
      const tokens = await login();
      expect(tokens.accessToken.split('.')).toHaveLength(3);
      expect(tokens.refreshToken).toHaveLength(64);
      expect(tokens.expiresIn).toBe(900);
    });

    it('rejects wrong credentials with 401 and no detail on which part was wrong', async () => {
      const res = await http()
        .post(`${BASE}/auth/login`)
        .send({ email: ADMIN.email, password: 'nope-nope-1' })
        .expect(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('is case-insensitive on email (citext)', async () => {
      await login(ADMIN.email.toUpperCase());
    });
  });

  describe('GET /auth/me', () => {
    it('returns profile, roles and effective permissions; never the password hash', async () => {
      const { accessToken } = await login();
      const res = await http()
        .get(`${BASE}/auth/me`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.email).toBe(ADMIN.email);
      expect(res.body.roles.map((r: { name: string }) => r.name)).toEqual([
        'ADMIN',
      ]);
      expect(res.body.permissions).toContain('user:invite');
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(res.body)).not.toContain('$argon2');
    });

    it('401 without a token', async () => {
      await http().get(`${BASE}/auth/me`).expect(401);
    });
  });

  describe('refresh token rotation', () => {
    it('rotates: new pair issued, old refresh token dead, reuse kills the family', async () => {
      const first = await login();

      const second = (
        await http()
          .post(`${BASE}/auth/refresh`)
          .send({ refreshToken: first.refreshToken })
          .expect(200)
      ).body;
      expect(second.refreshToken).not.toBe(first.refreshToken);

      // Replaying the first token = reuse → 401 and the whole family is revoked...
      await http()
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      // ...including the still-fresh second token.
      await http()
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken: second.refreshToken })
        .expect(401);
    });

    it('logout revokes the token; a second logout is a no-op', async () => {
      const { refreshToken } = await login();
      await http()
        .post(`${BASE}/auth/logout`)
        .send({ refreshToken })
        .expect(204);
      await http()
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken })
        .expect(401);
      await http()
        .post(`${BASE}/auth/logout`)
        .send({ refreshToken })
        .expect(204);
    });
  });

  describe('invite → accept → RBAC', () => {
    let inviteToken: string;
    let employeeTokens: { accessToken: string; refreshToken: string };
    const invitee = {
      email: 'new.hire@test.local',
      firstName: 'New',
      lastName: 'Hire',
      roles: ['EMPLOYEE'],
    };

    it('admin invites; the raw token is emitted as an event, not returned', async () => {
      const captured = new Promise<UserInvitedEvent>((resolve) =>
        app.get(EventEmitter2).once(AUTH_EVENTS.USER_INVITED, resolve),
      );
      const { accessToken } = await login();

      const res = await http()
        .post(`${BASE}/auth/invite`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(invitee)
        .expect(201);

      expect(res.body.status).toBe('INVITED');
      expect(JSON.stringify(res.body)).not.toMatch(/token/i);
      inviteToken = (await captured).inviteToken;
      expect(inviteToken).toBeTruthy();
    });

    it('invited user cannot log in yet', async () => {
      await http()
        .post(`${BASE}/auth/login`)
        .send({ email: invitee.email, password: 'whatever-123' })
        .expect(401);
    });

    it('accept-invite sets the password and returns a session', async () => {
      const res = await http()
        .post(`${BASE}/auth/accept-invite`)
        .send({ token: inviteToken, password: 'Welcome-2026' })
        .expect(200);
      employeeTokens = res.body;
      // Token is single use.
      await http()
        .post(`${BASE}/auth/accept-invite`)
        .send({ token: inviteToken, password: 'Welcome-2026' })
        .expect(401);
    });

    it('EMPLOYEE lacks user:read → 403 with the missing permission named', async () => {
      const res = await http()
        .get(`${BASE}/users`)
        .set('Authorization', `Bearer ${employeeTokens.accessToken}`)
        .expect(403);
      expect(res.body.message).toContain('user:read');
    });

    it('promoting to HR_MANAGER takes effect immediately (cache invalidated)', async () => {
      const admin = await login();
      const me = await http()
        .get(`${BASE}/auth/me`)
        .set('Authorization', `Bearer ${employeeTokens.accessToken}`)
        .expect(200);

      await http()
        .put(`${BASE}/users/${me.body.id}/roles`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ roles: ['EMPLOYEE', 'HR_MANAGER'] })
        .expect(200);

      await http()
        .get(`${BASE}/users`)
        .set('Authorization', `Bearer ${employeeTokens.accessToken}`)
        .expect(200);
    });

    it('suspension locks the user out on the very next request', async () => {
      const admin = await login();
      const me = await http()
        .get(`${BASE}/auth/me`)
        .set('Authorization', `Bearer ${employeeTokens.accessToken}`)
        .expect(200);

      await http()
        .put(`${BASE}/users/${me.body.id}/status`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ status: 'SUSPENDED' })
        .expect(200);

      await http()
        .get(`${BASE}/auth/me`)
        .set('Authorization', `Bearer ${employeeTokens.accessToken}`)
        .expect(401);
      await http()
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken: employeeTokens.refreshToken })
        .expect(401);
    });

    it('admin cannot suspend themselves', async () => {
      const admin = await login();
      const me = await http()
        .get(`${BASE}/auth/me`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      await http()
        .put(`${BASE}/users/${me.body.id}/status`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ status: 'SUSPENDED' })
        .expect(400);
    });
  });

  describe('password change invalidates old access tokens', () => {
    it('old token 401s after change-password; new login works', async () => {
      const before = await login();
      // JWT iat has 1s resolution; make sure the change lands in a later second.
      await new Promise((r) => setTimeout(r, 1100));

      await http()
        .post(`${BASE}/auth/change-password`)
        .set('Authorization', `Bearer ${before.accessToken}`)
        .send({
          currentPassword: ADMIN.password,
          newPassword: 'Rotated-Pass-1',
        })
        .expect(204);

      await http()
        .get(`${BASE}/auth/me`)
        .set('Authorization', `Bearer ${before.accessToken}`)
        .expect(401);
      await http()
        .post(`${BASE}/auth/refresh`)
        .send({ refreshToken: before.refreshToken })
        .expect(401);

      await login(ADMIN.email, 'Rotated-Pass-1');
      // restore for other suites
      const fresh = await login(ADMIN.email, 'Rotated-Pass-1');
      await http()
        .post(`${BASE}/auth/change-password`)
        .set('Authorization', `Bearer ${fresh.accessToken}`)
        .send({
          currentPassword: 'Rotated-Pass-1',
          newPassword: ADMIN.password,
        })
        .expect(204);
    });
  });

  describe('roles API', () => {
    it('system roles cannot be deleted; custom roles can', async () => {
      const admin = await login();
      const roles = (
        await http()
          .get(`${BASE}/roles`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .expect(200)
      ).body;
      const employeeRole = roles.find(
        (r: { name: string }) => r.name === 'EMPLOYEE',
      );
      await http()
        .delete(`${BASE}/roles/${employeeRole.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(400);

      const created = (
        await http()
          .post(`${BASE}/roles`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .send({
            name: 'AUDITOR',
            description: 'Read-only',
            permissions: ['user:read', 'role:read'],
          })
          .expect(201)
      ).body;
      expect(created.permissions).toHaveLength(2);
      await http()
        .delete(`${BASE}/roles/${created.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(204);
    });

    it('rejects unknown permissions at validation', async () => {
      const admin = await login();
      await http()
        .post(`${BASE}/roles`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'BROKEN', permissions: ['does:not_exist'] })
        .expect(400);
    });
  });
});
