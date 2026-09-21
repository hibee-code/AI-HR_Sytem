import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DepartmentsSeeder } from '../src/database/seeds/departments.seeder';
import { AUTH_EVENTS, UserInvitedEvent } from '../src/modules/auth/auth.events';
import { ADMIN, createTestApp, destroyTestApp } from './utils/test-app';

const BASE = '/api/v1';

const STRONG_CV = `Ada Lovelace — Senior Backend Engineer
Ten years building backend services in Node.js and TypeScript. Deep production experience with PostgreSQL,
including query tuning and migrations. Deployed and operated services on Kubernetes with Helm.
Led a team of five engineers; mentored juniors.`;

const WEAK_CV = `Bob Builder — Marketing Coordinator
Five years running social media campaigns and events. Strong copywriting and Canva skills.`;

describe('Recruiting & AI screening (e2e, fake driver)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => request.Agent;
  let admin: string;
  let recruiterToken: string;
  let employeeToken: string;
  let openingId: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const waitScreened = async (openingId: string, count: number) => {
    const start = Date.now();
    while (Date.now() - start < 15_000) {
      const [{ n }] = await ds.query(
        `SELECT COUNT(*)::int AS n FROM applications WHERE opening_id = $1 AND screening_status = 'DONE'`,
        [openingId],
      );
      if (n >= count) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('screening did not finish in time');
  };

  const hire = async (body: Record<string, unknown>, roles: string[]) => {
    const invited = new Promise<UserInvitedEvent>((r) =>
      app.get(EventEmitter2).once(AUTH_EVENTS.USER_INVITED, r),
    );
    await http()
      .post(`${BASE}/employees`)
      .set(auth(admin))
      .send({ ...body, status: 'ACTIVE', inviteLogin: { roles } })
      .expect(201);
    const { inviteToken } = await invited;
    return (
      await http()
        .post(`${BASE}/auth/accept-invite`)
        .send({ token: inviteToken, password: 'Pass-word-123' })
    ).body.accessToken as string;
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
    recruiterToken = await hire(
      {
        firstName: 'Rae',
        lastName: 'Recruit',
        workEmail: 'rae@test.local',
        hireDate: '2025-01-01',
        departmentId: eng,
      },
      ['RECRUITER'],
    );
    employeeToken = await hire(
      {
        firstName: 'Eve',
        lastName: 'Emp',
        workEmail: 'eve2@test.local',
        hireDate: '2025-01-01',
        departmentId: eng,
      },
      ['EMPLOYEE'],
    );

    openingId = (
      await http()
        .post(`${BASE}/recruiting/openings`)
        .set(auth(recruiterToken))
        .send({
          title: 'Senior Backend Engineer',
          departmentId: eng,
          description: 'Own our billing services end to end.',
          requirements: [
            'Production experience with PostgreSQL',
            'Kubernetes deployments',
            'TypeScript or Node.js backend services',
          ],
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await ds.query(
      'TRUNCATE TABLE applications, candidates, job_openings, document_versions, documents CASCADE',
    );
    await ds.query(
      'TRUNCATE TABLE checklist_tasks, checklists, notification_log, employment_history, employees, positions, departments CASCADE',
    );
    await destroyTestApp(app, ds);
  });

  it('applications are refused until the opening is OPEN; employees cannot see recruiting', async () => {
    await http()
      .post(`${BASE}/recruiting/openings/${openingId}/applications`)
      .set(auth(recruiterToken))
      .field('firstName', 'Ada')
      .field('lastName', 'L')
      .field('email', 'ada@x.io')
      .attach('file', Buffer.from(STRONG_CV), {
        filename: 'ada.md',
        contentType: 'text/markdown',
      })
      .expect(400);
    await http()
      .patch(`${BASE}/recruiting/openings/${openingId}`)
      .set(auth(recruiterToken))
      .send({ status: 'OPEN' })
      .expect(200);
    await http()
      .get(`${BASE}/recruiting/openings`)
      .set(auth(employeeToken))
      .expect(403);
  });

  it('two applicants get screened asynchronously and ranked; scores are flagged AI-assisted', async () => {
    for (const [first, last, email, cv] of [
      ['Ada', 'Lovelace', 'ada@x.io', STRONG_CV],
      ['Bob', 'Builder', 'bob@x.io', WEAK_CV],
    ]) {
      const res = await http()
        .post(`${BASE}/recruiting/openings/${openingId}/applications`)
        .set(auth(recruiterToken))
        .field('firstName', first)
        .field('lastName', last)
        .field('email', email)
        .field('source', 'careers-page')
        .attach('file', Buffer.from(cv), {
          filename: `${first}.md`,
          contentType: 'text/markdown',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'APPLIED',
        screeningStatus: 'PENDING',
        fitScore: null,
      });
    }
    await waitScreened(openingId, 2);

    const ranked = (
      await http()
        .get(`${BASE}/recruiting/openings/${openingId}/applications`)
        .set(auth(recruiterToken))
        .expect(200)
    ).body;
    expect(
      ranked.data.map(
        (a: { candidate: { email: string } }) => a.candidate.email,
      ),
    ).toEqual(['ada@x.io', 'bob@x.io']);
    const [ada, bob] = ranked.data;
    expect(ada.fitScore).toBeGreaterThan(bob.fitScore);
    expect(ada.screening).toMatchObject({
      aiAssisted: true,
      provider: 'fake',
      matchedRequirements: expect.arrayContaining([
        'Production experience with PostgreSQL',
      ]),
    });
    expect(ada.screening.similarity).toBeGreaterThan(bob.screening.similarity);

    const strong = (
      await http()
        .get(
          `${BASE}/recruiting/openings/${openingId}/applications?minScore=60`,
        )
        .set(auth(recruiterToken))
    ).body;
    expect(strong.data).toHaveLength(1);
  });

  it('résumé is a RESTRICTED document readable via recruiting, not via the documents API for non-HR', async () => {
    const apps = (
      await http()
        .get(`${BASE}/recruiting/openings/${openingId}/applications`)
        .set(auth(recruiterToken))
    ).body.data;
    const link = (
      await http()
        .get(`${BASE}/recruiting/applications/${apps[0].id}/resume`)
        .set(auth(recruiterToken))
        .expect(200)
    ).body;
    expect(link.url).toMatch(/^memory:\/\//);
    await http()
      .get(`${BASE}/documents/${apps[0].resumeDocumentId}`)
      .set(auth(recruiterToken))
      .expect(403);
    await http()
      .get(`${BASE}/documents/${apps[0].resumeDocumentId}`)
      .set(auth(admin))
      .expect(200); // HR read_all
  });

  it('duplicate application is refused; human status changes are recorded; rescreen re-queues', async () => {
    await http()
      .post(`${BASE}/recruiting/openings/${openingId}/applications`)
      .set(auth(recruiterToken))
      .field('firstName', 'Ada')
      .field('lastName', 'L')
      .field('email', 'ADA@x.io')
      .attach('file', Buffer.from(STRONG_CV), {
        filename: 'ada.md',
        contentType: 'text/markdown',
      })
      .expect(409);

    const apps = (
      await http()
        .get(`${BASE}/recruiting/openings/${openingId}/applications`)
        .set(auth(recruiterToken))
    ).body.data;
    const updated = (
      await http()
        .put(`${BASE}/recruiting/applications/${apps[0].id}/status`)
        .set(auth(recruiterToken))
        .send({ status: 'SHORTLISTED', note: 'Strong match' })
        .expect(200)
    ).body;
    expect(updated).toMatchObject({
      status: 'SHORTLISTED',
      notes: 'Strong match',
    });

    await http()
      .post(`${BASE}/recruiting/applications/${apps[0].id}/rescreen`)
      .set(auth(recruiterToken))
      .expect(202);
    await waitScreened(openingId, 2);
  });
});
