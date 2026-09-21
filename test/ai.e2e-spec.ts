import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DepartmentsSeeder } from '../src/database/seeds/departments.seeder';
import { AUTH_EVENTS, UserInvitedEvent } from '../src/modules/auth/auth.events';
import { ADMIN, createTestApp, destroyTestApp } from './utils/test-app';

const BASE = '/api/v1';

const LEAVE_POLICY = `Leave Policy

Annual leave: every full-time employee is entitled to twenty (20) working days of annual leave per calendar year.
Up to five unused days may be carried over into the next year and must be used by 31 March.
Requests are submitted in the HR portal and approved by your line manager.

Sick leave: ten (10) days per year. A medical certificate is required for absences longer than two consecutive days.
`;

describe('AI knowledge base & assistant (e2e, fake driver)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => request.Agent;
  let admin: string;
  let employeeToken: string;
  let policyId: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const waitFor = async (check: () => Promise<boolean>, ms = 10_000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('timed out');
  };

  beforeAll(async () => {
    process.env.WORKERS_ENABLED = 'true';
    ({ app, ds } = await createTestApp());
    await new DepartmentsSeeder().run(ds);
    http = () => request(app.getHttpServer());
    admin = (
      await http()
        .post(`${BASE}/auth/login`)
        .send({ email: ADMIN.email, password: ADMIN.password })
    ).body.accessToken;

    const eng = (
      await http().get(`${BASE}/departments`).set(auth(admin))
    ).body.find((d: { code: string }) => d.code === 'ENG').id;
    const invited = new Promise<UserInvitedEvent>((r) =>
      app.get(EventEmitter2).once(AUTH_EVENTS.USER_INVITED, r),
    );
    await http()
      .post(`${BASE}/employees`)
      .set(auth(admin))
      .send({
        firstName: 'Ask',
        lastName: 'Er',
        workEmail: 'asker@test.local',
        hireDate: '2025-01-01',
        status: 'ACTIVE',
        departmentId: eng,
        inviteLogin: { roles: ['EMPLOYEE'] },
      })
      .expect(201);
    const { inviteToken } = await invited;
    employeeToken = (
      await http()
        .post(`${BASE}/auth/accept-invite`)
        .send({ token: inviteToken, password: 'Pass-word-123' })
    ).body.accessToken;
  });

  afterAll(async () => {
    await ds.query(
      'TRUNCATE TABLE ai_messages, ai_conversations, knowledge_chunks, document_versions, documents CASCADE',
    );
    await ds.query(
      'TRUNCATE TABLE checklist_tasks, checklists, notification_log, employment_history, employees, positions, departments CASCADE',
    );
    await destroyTestApp(app, ds);
  });

  it('publishing a company policy indexes it automatically', async () => {
    policyId = (
      await http()
        .post(`${BASE}/documents`)
        .set(auth(admin))
        .field('title', 'Leave Policy')
        .field('category', 'POLICY')
        .field('visibility', 'COMPANY')
        .attach('file', Buffer.from(LEAVE_POLICY), {
          filename: 'leave-policy.md',
          contentType: 'text/markdown',
        })
        .expect(201)
    ).body.id;

    await waitFor(
      async () =>
        (
          await ds.query(
            `SELECT COUNT(*)::int AS n FROM knowledge_chunks WHERE document_id = $1`,
            [policyId],
          )
        )[0].n > 0,
    );
    const status = (
      await http()
        .get(`${BASE}/ai/knowledge-base/status`)
        .set(auth(admin))
        .expect(200)
    ).body;
    expect(status).toMatchObject({
      documents: 1,
      stale: 0,
      dimensions: 384,
      embeddingModel: 'fake-hash-embeddings',
    });
    expect(status.chatProviders.configured).toEqual(['fake']);
    const [{ indexed }] = await ds.query(
      `SELECT kb_indexed_at IS NOT NULL AS indexed FROM documents WHERE id = $1`,
      [policyId],
    );
    expect(indexed).toBe(true);
  });

  it('similarity search returns the relevant chunk (HR only)', async () => {
    const hits = (
      await http()
        .get(
          `${BASE}/ai/knowledge-base/search?q=how many annual leave days per year`,
        )
        .set(auth(admin))
        .expect(200)
    ).body;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({
      documentId: policyId,
      title: 'Leave Policy',
    });
    expect(hits[0].content).toContain('annual leave');
    await http()
      .get(`${BASE}/ai/knowledge-base/search?q=x`)
      .set(auth(employeeToken))
      .expect(403);
  });

  it('an employee gets a grounded, cited answer; conversation persists; follow-ups continue it', async () => {
    const first = (
      await http()
        .post(`${BASE}/ai/assistant/chat`)
        .set(auth(employeeToken))
        .send({ message: 'How many annual leave days do I get per year?' })
        .expect(201)
    ).body;
    expect(first).toMatchObject({ grounded: true, provider: 'fake' });
    expect(first.answer).toMatch(/\[1\]/);
    expect(first.citations[0]).toMatchObject({
      ref: 1,
      documentId: policyId,
      title: 'Leave Policy',
    });

    const second = (
      await http()
        .post(`${BASE}/ai/assistant/chat`)
        .set(auth(employeeToken))
        .send({
          message: 'And can I carry days over?',
          conversationId: first.conversationId,
        })
        .expect(201)
    ).body;
    expect(second.conversationId).toBe(first.conversationId);

    const conv = (
      await http()
        .get(`${BASE}/ai/assistant/conversations/${first.conversationId}`)
        .set(auth(employeeToken))
        .expect(200)
    ).body;
    expect(conv.messages.map((m: { role: string }) => m.role)).toEqual([
      'USER',
      'ASSISTANT',
      'USER',
      'ASSISTANT',
    ]);
    expect(conv.title).toContain('How many annual leave days');

    await http()
      .get(`${BASE}/ai/assistant/conversations/${first.conversationId}`)
      .set(auth(admin))
      .expect(403);
  });

  it('unrelated questions get the not-found answer without a model call', async () => {
    const res = (
      await http()
        .post(`${BASE}/ai/assistant/chat`)
        .set(auth(employeeToken))
        .send({ message: 'zxqv plorth wibble' })
        .expect(201)
    ).body;
    expect(res).toMatchObject({ grounded: false, provider: 'none' });
    expect(res.answer).toContain("couldn't find");
  });

  it('withdrawing the policy from company visibility removes it from the knowledge base', async () => {
    await http()
      .patch(`${BASE}/documents/${policyId}`)
      .set(auth(admin))
      .send({ visibility: 'PRIVATE' })
      .expect(200);
    await waitFor(
      async () =>
        (
          await ds.query(
            `SELECT COUNT(*)::int AS n FROM knowledge_chunks WHERE document_id = $1`,
            [policyId],
          )
        )[0].n === 0,
    );
    const res = (
      await http()
        .post(`${BASE}/ai/assistant/chat`)
        .set(auth(employeeToken))
        .send({ message: 'How many annual leave days do I get?' })
        .expect(201)
    ).body;
    expect(res.grounded).toBe(false);
  });
});
