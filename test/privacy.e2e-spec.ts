import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DepartmentsSeeder } from '../src/database/seeds/departments.seeder';
import { ADMIN, createTestApp, destroyTestApp } from './utils/test-app';

const BASE = '/api/v1';
const CV =
  'Backend engineer with eight years of PostgreSQL and Node.js. ada@x.io +234 803 123 4567';

describe('Privacy: data-subject export, erasure, retention (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => request.Agent;
  let admin: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    await new DepartmentsSeeder().run(ds);
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
      'TRUNCATE TABLE applications, candidates, job_openings, document_versions, documents, ai_conversations, departments CASCADE',
    );
    await destroyTestApp(app, ds);
  });

  it('exports everything about the caller, without secrets', async () => {
    const res = await http()
      .get(`${BASE}/privacy/me/export`)
      .set(auth(admin))
      .expect(200);
    expect(res.body.data.account[0].email).toBe(ADMIN.email);
    expect(res.body.data.roles).toEqual([{ name: 'ADMIN' }]);
    expect(Object.keys(res.body.data)).toEqual(
      expect.arrayContaining([
        'sessions',
        'payslips',
        'aiMessages',
        'auditTrail',
      ]),
    );
    const dump = JSON.stringify(res.body);
    expect(dump).not.toMatch(/password_hash|mfa_secret|token_hash|\$argon2/);
  });

  it('erases an applicant for good: applications, résumé file and record', async () => {
    const eng = (
      await http().get(`${BASE}/departments`).set(auth(admin))
    ).body.find((d: { code: string }) => d.code === 'ENG').id;
    const opening = (
      await http()
        .post(`${BASE}/recruiting/openings`)
        .set(auth(admin))
        .send({
          title: 'Backend Engineer',
          departmentId: eng,
          description: 'APIs.',
          requirements: ['PostgreSQL'],
        })
        .expect(201)
    ).body;
    await http()
      .patch(`${BASE}/recruiting/openings/${opening.id}`)
      .set(auth(admin))
      .send({ status: 'OPEN' })
      .expect(200);
    const application = (
      await http()
        .post(`${BASE}/recruiting/openings/${opening.id}/applications`)
        .set(auth(admin))
        .field('firstName', 'Ada')
        .field('lastName', 'Lovelace')
        .field('email', 'ada@x.io')
        .attach('file', Buffer.from(CV), {
          filename: 'ada.md',
          contentType: 'text/markdown',
        })
        .expect(201)
    ).body;
    const candidateId = application.candidateId;

    const exported = (
      await http()
        .get(`${BASE}/privacy/candidates/${candidateId}/export`)
        .set(auth(admin))
        .expect(200)
    ).body;
    expect(exported.data.applications).toHaveLength(1);
    expect(exported.data.resumes).toHaveLength(1);

    const erased = await http()
      .delete(`${BASE}/privacy/candidates/${candidateId}`)
      .set(auth(admin))
      .expect(200);
    expect(erased.body).toEqual({ applications: 1, resumes: 1 });

    const left = await ds.query(
      `SELECT (SELECT count(*) FROM candidates WHERE id = $1)::int AS candidates,
              (SELECT count(*) FROM documents WHERE id = $2)::int AS documents,
              (SELECT count(*) FROM document_versions WHERE document_id = $2)::int AS versions`,
      [candidateId, application.resumeDocumentId],
    );
    expect(left[0]).toEqual({ candidates: 0, documents: 0, versions: 0 });
    await http()
      .get(`${BASE}/privacy/candidates/${candidateId}/export`)
      .set(auth(admin))
      .expect(404);
  });

  it('retention deletes what is past its period and keeps the rest', async () => {
    const [{ id: adminId }] = await ds.query(
      `SELECT id FROM users WHERE email = $1`,
      [ADMIN.email],
    );
    await ds.query(
      `INSERT INTO notification_log (channel, template, created_at)
       VALUES ('EMAIL', 'OLD', now() - interval '400 days'), ('EMAIL', 'NEW', now())`,
    );
    await ds.query(
      `INSERT INTO ai_conversations (user_id, title, created_at, updated_at)
       VALUES ($1, 'old chat', now() - interval '400 days', now() - interval '400 days'),
              ($1, 'new chat', now(), now())`,
      [adminId],
    );
    await ds.query(
      `INSERT INTO audit_logs (action, resource_type, created_at)
       VALUES ('ancient', 't', now() - interval '3000 days')`,
    );

    const res = await http()
      .post(`${BASE}/privacy/retention/run`)
      .set(auth(admin))
      .expect(201);
    expect(res.body).toMatchObject({
      notifications: 1,
      conversations: 1,
      audit: 1,
    });

    const [after] = await ds.query(
      `SELECT (SELECT array_agg(template) FROM notification_log WHERE template IN ('OLD','NEW')) AS logs,
              (SELECT array_agg(title) FROM ai_conversations) AS chats,
              (SELECT count(*) FROM audit_logs WHERE action = 'ancient')::int AS ancient`,
    );
    expect(after).toEqual({ logs: ['NEW'], chats: ['new chat'], ancient: 0 });
  });
});
