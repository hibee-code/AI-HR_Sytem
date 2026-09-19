import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DepartmentsSeeder } from '../src/database/seeds/departments.seeder';
import { AUTH_EVENTS, UserInvitedEvent } from '../src/modules/auth/auth.events';
import { ADMIN, createTestApp, destroyTestApp } from './utils/test-app';

const BASE = '/api/v1';

describe('Performance (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => request.Agent;
  let admin: string;
  let mgr: { id: string; token: string; userId: string };
  let emp: { id: string; token: string; userId: string };
  let peer: { id: string; token: string; userId: string };
  let cycleId: string;
  let reviewId: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const hire = async (body: Record<string, unknown>, roles: string[]) => {
    const invited = new Promise<UserInvitedEvent>((r) =>
      app.get(EventEmitter2).once(AUTH_EVENTS.USER_INVITED, r),
    );
    const res = await http()
      .post(`${BASE}/employees`)
      .set(auth(admin))
      .send({ ...body, status: 'ACTIVE', inviteLogin: { roles } })
      .expect(201);
    const { inviteToken, userId } = await invited;
    const token = (
      await http()
        .post(`${BASE}/auth/accept-invite`)
        .send({ token: inviteToken, password: 'Pass-word-123' })
    ).body.accessToken;
    return { id: res.body.id as string, token: token as string, userId };
  };

  beforeAll(async () => {
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
    mgr = await hire(
      {
        firstName: 'Mara',
        lastName: 'Mgr',
        workEmail: 'mara@test.local',
        hireDate: '2024-01-01',
        departmentId: eng,
      },
      ['MANAGER'],
    );
    emp = await hire(
      {
        firstName: 'Ravi',
        lastName: 'Rev',
        workEmail: 'ravi@test.local',
        hireDate: '2025-01-01',
        departmentId: eng,
        managerId: mgr.id,
      },
      ['EMPLOYEE'],
    );
    peer = await hire(
      {
        firstName: 'Pia',
        lastName: 'Peer',
        workEmail: 'pia@test.local',
        hireDate: '2025-01-01',
        departmentId: eng,
        managerId: mgr.id,
      },
      ['EMPLOYEE'],
    );
  });

  afterAll(async () => {
    await ds.query(
      'TRUNCATE TABLE review_feedback, reviews, goals, review_cycles CASCADE',
    );
    await ds.query(
      'TRUNCATE TABLE checklist_tasks, checklists, notification_log, employment_history, employees, positions, departments CASCADE',
    );
    await destroyTestApp(app, ds);
  });

  it('HR creates and launches a cycle; every active employee gets a review with their manager as reviewer', async () => {
    cycleId = (
      await http()
        .post(`${BASE}/performance/cycles`)
        .set(auth(admin))
        .send({
          name: 'H2 2026',
          periodStart: '2026-07-01',
          periodEnd: '2026-12-31',
          selfReviewDeadline: '2027-01-15',
          managerReviewDeadline: '2027-01-31',
          competencies: ['Ownership', 'Craft'],
        })
        .expect(201)
    ).body.id;

    const { created, cycle } = (
      await http()
        .post(`${BASE}/performance/cycles/${cycleId}/launch`)
        .set(auth(admin))
        .expect(201)
    ).body;
    expect(created).toBe(3);
    expect(cycle.phase).toBe('SELF_REVIEW');

    const mine = (
      await http()
        .get(`${BASE}/performance/reviews/me`)
        .set(auth(emp.token))
        .expect(200)
    ).body;
    expect(mine.data).toHaveLength(1);
    reviewId = mine.data[0].id;
    expect(mine.data[0].reviewerUserId).toBe(mgr.userId);

    const pending = (
      await http()
        .get(`${BASE}/performance/reviews/pending`)
        .set(auth(mgr.token))
        .expect(200)
    ).body;
    expect(
      pending.map((r: { employeeId: string }) => r.employeeId).sort(),
    ).toEqual([emp.id, peer.id].sort());
  });

  it('goals: employee proposes (DRAFT), manager approves; weight cap enforced', async () => {
    const g = (
      await http()
        .post(`${BASE}/performance/goals`)
        .set(auth(emp.token))
        .send({ cycleId, title: 'Ship billing', weight: 60 })
        .expect(201)
    ).body;
    expect(g.status).toBe('DRAFT');
    await http()
      .post(`${BASE}/performance/goals`)
      .set(auth(emp.token))
      .send({ title: 'Too much', weight: 50 })
      .expect(400);
    const approved = (
      await http()
        .post(`${BASE}/performance/goals/${g.id}/approve`)
        .set(auth(mgr.token))
        .expect(201)
    ).body;
    expect(approved.status).toBe('ACTIVE');
    await http()
      .patch(`${BASE}/performance/goals/${g.id}`)
      .set(auth(emp.token))
      .send({ progress: 40 })
      .expect(200);
    await http()
      .patch(`${BASE}/performance/goals/${g.id}`)
      .set(auth(emp.token))
      .send({ title: 'Renamed' })
      .expect(400);
  });

  it('self-review, peer feedback, manager review, calibration, close, acknowledge', async () => {
    const assessment = {
      summary: 'Solid half',
      competencies: { Ownership: 4, Craft: 3 },
      rating: 4,
    };
    await http()
      .put(`${BASE}/performance/reviews/${reviewId}/manager`)
      .set(auth(mgr.token))
      .send(assessment)
      .expect(400); // not yet
    await http()
      .put(`${BASE}/performance/reviews/${reviewId}/self`)
      .set(auth(emp.token))
      .send({ ...assessment, competencies: { Ownership: 4 } })
      .expect(400);
    await http()
      .put(`${BASE}/performance/reviews/${reviewId}/self`)
      .set(auth(emp.token))
      .send(assessment)
      .expect(200);

    // Peer feedback
    await http()
      .post(`${BASE}/performance/reviews/${reviewId}/feedback-requests`)
      .set(auth(emp.token))
      .send({ giverUserIds: [peer.userId] })
      .expect(201);
    const requests = (
      await http()
        .get(`${BASE}/performance/feedback/me`)
        .set(auth(peer.token))
        .expect(200)
    ).body;
    expect(requests).toHaveLength(1);
    await http()
      .put(`${BASE}/performance/feedback/${requests[0].id}`)
      .set(auth(peer.token))
      .send({ strengths: 'Reliable', improvements: 'Docs', rating: 4 })
      .expect(200);

    // Manager phase
    await http()
      .post(`${BASE}/performance/cycles/${cycleId}/advance`)
      .set(auth(admin))
      .expect(201);
    const mgrView = (
      await http()
        .get(`${BASE}/performance/reviews/${reviewId}`)
        .set(auth(mgr.token))
        .expect(200)
    ).body;
    expect(mgrView.review.selfRating).toBe(4);
    expect(mgrView.feedback[0].giverName).toBe('Pia Peer');
    await http()
      .put(`${BASE}/performance/reviews/${reviewId}/manager`)
      .set(auth(mgr.token))
      .send({ ...assessment, rating: 3 })
      .expect(200);

    // Employee still cannot see the manager rating
    const empView = (
      await http()
        .get(`${BASE}/performance/reviews/${reviewId}`)
        .set(auth(emp.token))
        .expect(200)
    ).body;
    expect(empView.review.managerRating).toBeNull();
    expect(empView.feedback).toEqual([]);
    await http()
      .get(`${BASE}/performance/reviews/${reviewId}`)
      .set(auth(peer.token))
      .expect(403);

    // Calibration
    await http()
      .post(`${BASE}/performance/cycles/${cycleId}/advance`)
      .set(auth(admin))
      .expect(201);
    await http()
      .put(`${BASE}/performance/reviews/${reviewId}/calibrate`)
      .set(auth(admin))
      .send({ finalRating: 4, note: 'Levelled up' })
      .expect(200);

    // Close
    const closed = (
      await http()
        .post(`${BASE}/performance/cycles/${cycleId}/advance`)
        .set(auth(admin))
        .expect(201)
    ).body;
    expect(closed.phase).toBe('CLOSED');
    const final = (
      await http()
        .get(`${BASE}/performance/reviews/${reviewId}`)
        .set(auth(emp.token))
        .expect(200)
    ).body;
    expect(final.review).toMatchObject({
      status: 'COMPLETED',
      finalRating: 4,
      calibrationNote: null,
    });
    expect(final.feedback[0].answers.strengths).toBe('Reliable');
    expect(JSON.stringify(final.feedback)).not.toContain('Pia');

    await http()
      .post(`${BASE}/performance/reviews/${reviewId}/acknowledge`)
      .set(auth(emp.token))
      .send({ comment: 'Thanks' })
      .expect(201);

    const report = (
      await http()
        .get(`${BASE}/performance/cycles/${cycleId}/report`)
        .set(auth(admin))
        .expect(200)
    ).body;
    const engRow = report.find(
      (r: { department: string }) => r.department === 'Engineering',
    );
    expect(engRow).toMatchObject({ reviews: 3, acknowledged: 1 });
    expect(engRow.distribution['4']).toBe(1);

    const log = await ds.query(
      `SELECT template, COUNT(*)::int AS n FROM notification_log GROUP BY template`,
    );
    const templates = Object.fromEntries(
      log.map((r: { template: string; n: number }) => [r.template, r.n]),
    );
    expect(templates.REVIEW_CYCLE_LAUNCHED).toBeGreaterThanOrEqual(3);
    expect(templates.FEEDBACK_REQUESTED).toBeGreaterThanOrEqual(1);
    expect(templates.REVIEW_COMPLETED).toBeGreaterThanOrEqual(1);
  });
});
