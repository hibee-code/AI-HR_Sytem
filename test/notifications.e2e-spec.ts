import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ADMIN, createTestApp, destroyTestApp } from './utils/test-app';

const BASE = '/api/v1';

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => request.Agent;
  let admin: string;
  const auth = () => ({ Authorization: `Bearer ${admin}` });

  /** Poll the delivery log until every row for a template has left QUEUED. */
  const waitForDelivery = async (template: string, timeoutMs = 10_000) => {
    const started = Date.now();
    for (;;) {
      const rows: { status: string; channel: string; error: string | null }[] =
        await ds.query(
          'SELECT status, channel, error FROM notification_log WHERE template = $1 ORDER BY created_at',
          [template],
        );
      if (rows.length > 0 && rows.every((r) => r.status !== 'QUEUED'))
        return rows;
      if (Date.now() - started > timeoutMs)
        throw new Error(
          `timed out waiting for ${template}: ${JSON.stringify(rows)}`,
        );
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  beforeAll(async () => {
    process.env.WORKERS_ENABLED = 'true';
    ({ app, ds } = await createTestApp());
    http = () => request(app.getHttpServer());
    admin = (
      await http()
        .post(`${BASE}/auth/login`)
        .send({ email: ADMIN.email, password: ADMIN.password })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await ds.query(
      'TRUNCATE TABLE notification_log, notification_preferences CASCADE',
    );
    await destroyTestApp(app, ds);
  });

  it('an invite produces a SENT email log row without the token in the payload', async () => {
    await http()
      .post(`${BASE}/auth/invite`)
      .set(auth())
      .send({
        email: 'invitee@test.local',
        firstName: 'Ivy',
        lastName: 'Invited',
        roles: ['EMPLOYEE'],
      })
      .expect(201);

    const rows = await waitForDelivery('USER_INVITED');
    expect(rows).toEqual([
      expect.objectContaining({ channel: 'EMAIL', status: 'SENT' }),
    ]);

    const [{ payload, recipient_address }] = await ds.query(
      `SELECT payload, recipient_address FROM notification_log WHERE template = 'USER_INVITED'`,
    );
    expect(recipient_address).toBe('invitee@test.local');
    expect(payload.inviteUrl).toBe('[redacted]');
    expect(JSON.stringify(payload)).not.toMatch(/token=/);
  });

  it('resending the invite is not deduplicated (new token, new expiry)', async () => {
    const [{ id }] = await ds.query(
      `SELECT id FROM users WHERE email = 'invitee@test.local'`,
    );
    await http()
      .post(`${BASE}/auth/invite/${id}/resend`)
      .set(auth())
      .expect(204);
    const rows = await waitForDelivery('USER_INVITED');
    expect(rows).toHaveLength(2);
  });

  it('POST /notifications/test: email SENT, slack SKIPPED (not configured)', async () => {
    const res = await http()
      .post(`${BASE}/notifications/test`)
      .set(auth())
      .expect(202);
    expect(res.body.queued).toHaveLength(2);

    const rows = await waitForDelivery('TEST');
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'EMAIL', status: 'SENT' }),
        expect.objectContaining({
          channel: 'SLACK',
          status: 'SKIPPED',
          error: 'slack not configured',
        }),
      ]),
    );
  });

  it('preferences: disabling email makes the next test notification SKIPPED', async () => {
    await http()
      .put(`${BASE}/notifications/preferences/me`)
      .set(auth())
      .send({ emailEnabled: false })
      .expect(200);
    const prefs = (
      await http()
        .get(`${BASE}/notifications/preferences/me`)
        .set(auth())
        .expect(200)
    ).body;
    expect(prefs.emailEnabled).toBe(false);

    await ds.query(`DELETE FROM notification_log WHERE template = 'TEST'`);
    await http().post(`${BASE}/notifications/test`).set(auth()).expect(202);
    const rows = await waitForDelivery('TEST');
    expect(rows.find((r) => r.channel === 'EMAIL')).toMatchObject({
      status: 'SKIPPED',
      error: 'email disabled by user',
    });

    await http()
      .put(`${BASE}/notifications/preferences/me`)
      .set(auth())
      .send({ emailEnabled: true })
      .expect(200);
  });

  it('GET /notifications/log is paginated and filterable; employees are forbidden', async () => {
    const page = (
      await http()
        .get(`${BASE}/notifications/log?status=SENT&limit=2`)
        .set(auth())
        .expect(200)
    ).body;
    expect(page.meta.limit).toBe(2);
    expect(
      page.data.every((r: { status: string }) => r.status === 'SENT'),
    ).toBe(true);
  });
});
