import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { totpCode, totpStep } from '../src/common/security/totp';
import { AUTH_EVENTS, UserInvitedEvent } from '../src/modules/auth/auth.events';
import { ADMIN, createTestApp, destroyTestApp } from './utils/test-app';

const BASE = '/api/v1';
const PASSWORD = 'Str0ngPassw0rd!';

describe('Security: MFA, lockout, audit trail (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => request.Agent;
  let admin: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    http = () => request(app.getHttpServer());
    admin = (
      await http()
        .post(`${BASE}/auth/login`)
        .send({ email: ADMIN.email, password: ADMIN.password })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(() => destroyTestApp(app, ds));

  /** Invite + accept → an active EMPLOYEE with a known password. */
  async function newUser(
    email: string,
  ): Promise<{ id: string; token: string }> {
    const invited = new Promise<UserInvitedEvent>((resolve) =>
      app.get(EventEmitter2).once(AUTH_EVENTS.USER_INVITED, resolve),
    );
    const { id } = (
      await http()
        .post(`${BASE}/auth/invite`)
        .set(auth(admin))
        .send({
          email,
          firstName: 'Sam',
          lastName: 'Secure',
          roles: ['EMPLOYEE'],
        })
        .expect(201)
    ).body;
    const { inviteToken } = await invited;
    const session = await http()
      .post(`${BASE}/auth/accept-invite`)
      .send({ token: inviteToken, password: PASSWORD })
      .expect(200);
    return { id, token: session.body.accessToken };
  }

  const login = (email: string, password = PASSWORD) =>
    http().post(`${BASE}/auth/login`).send({ email, password });

  describe('TOTP MFA', () => {
    let secret: string;
    let recoveryCodes: string[];
    const email = 'mfa@test.local';

    it('enrols: setup → enable with a code → recovery codes; /me reflects it', async () => {
      const { token } = await newUser(email);
      const setup = await http()
        .post(`${BASE}/auth/mfa/setup`)
        .set(auth(token))
        .expect(201);
      secret = setup.body.secret;
      expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);

      await http()
        .post(`${BASE}/auth/mfa/enable`)
        .set(auth(token))
        .send({ code: '000000' })
        .expect(400);
      const enabled = await http()
        .post(`${BASE}/auth/mfa/enable`)
        .set(auth(token))
        .send({ code: totpCode(secret, totpStep()) })
        .expect(200);
      recoveryCodes = enabled.body.recoveryCodes;
      expect(recoveryCodes).toHaveLength(10);

      const me = await http()
        .get(`${BASE}/auth/me`)
        .set(auth(token))
        .expect(200);
      expect(me.body).toMatchObject({
        mfaEnabled: true,
        mfaSetupRequired: false,
      });
      expect(me.body).not.toHaveProperty('mfaSecret');
    });

    it('login now stops at a challenge; a fresh code completes it; replay fails', async () => {
      const first = await login(email).expect(200);
      expect(first.body).toEqual({
        mfaRequired: true,
        mfaToken: expect.any(String),
        expiresIn: 300,
      });
      // The challenge is not an access token.
      await http()
        .get(`${BASE}/auth/me`)
        .set(auth(first.body.mfaToken))
        .expect(401);

      const code = totpCode(secret, totpStep() + 1); // the enrol code used this step
      const done = await http()
        .post(`${BASE}/auth/mfa/verify`)
        .send({ mfaToken: first.body.mfaToken, code })
        .expect(200);
      expect(done.body).toMatchObject({
        mfaRequired: false,
        tokenType: 'Bearer',
      });

      const again = await login(email).expect(200);
      await http()
        .post(`${BASE}/auth/mfa/verify`)
        .send({ mfaToken: again.body.mfaToken, code })
        .expect(401);
    });

    it('a recovery code works exactly once', async () => {
      const challenge = async () =>
        (await login(email).expect(200)).body.mfaToken;
      await http()
        .post(`${BASE}/auth/mfa/verify`)
        .send({ mfaToken: await challenge(), code: recoveryCodes[0] })
        .expect(200);
      await http()
        .post(`${BASE}/auth/mfa/verify`)
        .send({ mfaToken: await challenge(), code: recoveryCodes[0] })
        .expect(401);
    });

    it('admin can reset a lost authenticator; login is password-only again', async () => {
      const [{ id }] = await ds.query(`SELECT id FROM users WHERE email = $1`, [
        email,
      ]);
      // The previous test's bad recovery code counted as a failure; start clean.
      await http()
        .post(`${BASE}/users/${id}/unlock`)
        .set(auth(admin))
        .expect(201);
      await http()
        .post(`${BASE}/users/${id}/mfa/reset`)
        .set(auth(admin))
        .expect(204);
      const res = await login(email).expect(200);
      expect(res.body).toMatchObject({ mfaRequired: false });
    });
  });

  describe('lockout', () => {
    const email = 'lock@test.local';
    let userId: string;

    it('locks after 5 bad passwords: the right one then gets the same 401 as a wrong one, and the owner is emailed', async () => {
      ({ id: userId } = await newUser(email));
      for (let i = 0; i < 5; i++)
        await login(email, 'wrong-password-1').expect(401);

      // Indistinguishable from bad credentials or an unknown email (no enumeration).
      const locked = await login(email).expect(401);
      const unknown = await login('nobody@test.local').expect(401);
      expect(locked.body.message).toBe(unknown.body.message);

      const deadline = Date.now() + 10_000;
      let mail: { status: string }[] = [];
      while (Date.now() < deadline && mail.length === 0) {
        mail = await ds.query(
          `SELECT status FROM notification_log WHERE template = 'ACCOUNT_LOCKED' AND recipient_address = $1`,
          [email],
        );
        if (!mail.length) await new Promise((r) => setTimeout(r, 200));
      }
      expect(mail.length).toBe(1);

      await http()
        .post(`${BASE}/users/${userId}/unlock`)
        .set(auth(admin))
        .expect(201);
      await login(email).expect(200);
    });

    it('a successful login resets the counter', async () => {
      for (let i = 0; i < 4; i++)
        await login(email, 'wrong-password-1').expect(401);
      await login(email).expect(200);
      for (let i = 0; i < 4; i++)
        await login(email, 'wrong-password-1').expect(401);
      await login(email).expect(200);
    });
  });

  describe('password reset with MFA', () => {
    it('needs an authenticator code as well as the emailed link; a wrong code keeps the link usable', async () => {
      const email = 'reset-mfa@test.local';
      const { token } = await newUser(email);
      const { secret } = (
        await http().post(`${BASE}/auth/mfa/setup`).set(auth(token)).expect(201)
      ).body;
      await http()
        .post(`${BASE}/auth/mfa/enable`)
        .set(auth(token))
        .send({ code: totpCode(secret, totpStep()) })
        .expect(200);

      const requested = new Promise<{ resetToken: string }>((resolve) =>
        app
          .get(EventEmitter2)
          .once(AUTH_EVENTS.PASSWORD_RESET_REQUESTED, resolve),
      );
      await http()
        .post(`${BASE}/auth/forgot-password`)
        .send({ email })
        .expect(202);
      const { resetToken } = await requested;
      const reset = (code?: string) =>
        http()
          .post(`${BASE}/auth/reset-password`)
          .send({
            token: resetToken,
            password: 'Brand-New-Passw0rd',
            ...(code && { code }),
          });

      expect((await reset().expect(401)).body.error).toBe('MFA_REQUIRED');
      await reset('000000').expect(401);
      await reset(totpCode(secret, totpStep() + 1)).expect(204); // link still valid
      await reset(totpCode(secret, totpStep() + 1)).expect(401); // now burned
    });
  });

  describe('audit trail', () => {
    it('records logins, failures, the lock and admin actions; readable by ADMIN only', async () => {
      const res = await http()
        .get(`${BASE}/audit-logs?limit=100`)
        .set(auth(admin))
        .expect(200);
      const actions = new Set(
        (res.body.data as { action: string }[]).map((r) => r.action),
      );
      for (const a of [
        'user.invite',
        'auth.login',
        'auth.login_failed',
        'auth.locked',
        'auth.mfa.enable',
        'user.unlock',
        'user.mfa.reset',
      ])
        expect(actions).toContain(a);

      const locked = (
        res.body.data as { action: string; ipAddress: string }[]
      ).find((r) => r.action === 'auth.locked');
      expect(locked?.ipAddress).toBeTruthy();

      const filtered = await http()
        .get(`${BASE}/audit-logs?action=user.unlock`)
        .set(auth(admin))
        .expect(200);
      expect(
        filtered.body.data.every(
          (r: { action: string }) => r.action === 'user.unlock',
        ),
      ).toBe(true);

      const employee = (await login('lock@test.local').expect(200)).body
        .accessToken;
      await http().get(`${BASE}/audit-logs`).set(auth(employee)).expect(403);
    });

    it('the table is append-only at the database level', async () => {
      await expect(
        ds.query(`UPDATE audit_logs SET action = 'tampered'`),
      ).rejects.toThrow(/append-only/);
      await expect(ds.query(`DELETE FROM audit_logs`)).rejects.toThrow(
        /append-only/,
      );
    });

    it('never stores secrets in metadata', async () => {
      const rows: { metadata: unknown }[] = await ds.query(
        `SELECT metadata FROM audit_logs`,
      );
      const dump = JSON.stringify(rows);
      expect(dump).not.toContain(PASSWORD);
      expect(dump).not.toContain(ADMIN.password);
      expect(dump).not.toMatch(
        /"(mfaToken|accessToken|refreshToken|code|secret)"/,
      );
    });
  });
});
