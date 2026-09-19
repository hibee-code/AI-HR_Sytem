import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { addDays } from '../src/common/utils/date';
import { DepartmentsSeeder } from '../src/database/seeds/departments.seeder';
import { LeavePolicySeeder } from '../src/database/seeds/leave-policy.seeder';
import { AUTH_EVENTS, UserInvitedEvent } from '../src/modules/auth/auth.events';
import { ADMIN, createTestApp, destroyTestApp } from './utils/test-app';

const BASE = '/api/v1';

/** Next Monday at least 7 days out, so requests are in the future and start on a working day. */
function nextMonday(): string {
  let d = addDays(new Date().toISOString().slice(0, 10), 7);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
  return d;
}

describe('Leave & attendance (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => request.Agent;
  let admin: string;
  let managerToken: string;
  let employeeToken: string;
  let employeeId: string;
  let annualTypeId: string;
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
    const { inviteToken } = await invited;
    const token = (
      await http()
        .post(`${BASE}/auth/accept-invite`)
        .send({ token: inviteToken, password: 'Pass-word-123' })
        .expect(200)
    ).body.accessToken;
    return { id: res.body.id as string, token: token as string };
  };

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    await new DepartmentsSeeder().run(ds);
    await new LeavePolicySeeder().run(ds);
    http = () => request(app.getHttpServer());
    admin = (
      await http()
        .post(`${BASE}/auth/login`)
        .send({ email: ADMIN.email, password: ADMIN.password })
    ).body.accessToken;

    const depts = (await http().get(`${BASE}/departments`).set(auth(admin)))
      .body;
    const eng = depts.find((d: { code: string }) => d.code === 'ENG').id;
    const mgr = await hire(
      {
        firstName: 'Mia',
        lastName: 'Manager',
        workEmail: 'mia@test.local',
        hireDate: '2024-01-01',
        departmentId: eng,
      },
      ['MANAGER'],
    );
    managerToken = mgr.token;
    const emp = await hire(
      {
        firstName: 'Eve',
        lastName: 'Employee',
        workEmail: 'eve@test.local',
        hireDate: '2025-01-01',
        departmentId: eng,
        managerId: mgr.id,
      },
      ['EMPLOYEE'],
    );
    employeeToken = emp.token;
    employeeId = emp.id;

    const types = (
      await http()
        .get(`${BASE}/leave/types`)
        .set(auth(employeeToken))
        .expect(200)
    ).body;
    annualTypeId = types.find((t: { code: string }) => t.code === 'ANNUAL').id;
  });

  afterAll(async () => {
    await ds.query(
      'TRUNCATE TABLE attendance_records, leave_requests, leave_balance_adjustments, leave_balances, public_holidays, leave_types CASCADE',
    );
    await ds.query(
      'TRUNCATE TABLE checklist_tasks, checklists, notification_log, employment_history, employees, positions, departments CASCADE',
    );
    await destroyTestApp(app, ds);
  });

  describe('leave', () => {
    let requestId: string;
    const monday = nextMonday();

    it('balances are provisioned lazily with the full entitlement for a prior-year hire', async () => {
      const balances = (
        await http()
          .get(`${BASE}/leave/balances/me`)
          .set(auth(employeeToken))
          .expect(200)
      ).body;
      const annual = balances.find(
        (b: { leaveTypeId: string }) => b.leaveTypeId === annualTypeId,
      );
      expect(annual).toMatchObject({
        entitled: 20,
        used: 0,
        pending: 0,
        available: 20,
      });
      expect(
        balances.find(
          (b: { leaveType: { code: string } }) => b.leaveType.code === 'UNPAID',
        ),
      ).toBeUndefined();
    });

    it('employee submits Mon–Wed (3 days); pending is reserved; manager sees it in their queue', async () => {
      const res = await http()
        .post(`${BASE}/leave/requests`)
        .set(auth(employeeToken))
        .send({
          leaveTypeId: annualTypeId,
          startDate: monday,
          endDate: addDays(monday, 2),
          reason: 'Trip',
        })
        .expect(201);
      requestId = res.body.id;
      expect(res.body).toMatchObject({ days: 3, status: 'PENDING' });

      const balances = (
        await http().get(`${BASE}/leave/balances/me`).set(auth(employeeToken))
      ).body;
      expect(
        balances.find(
          (b: { leaveTypeId: string }) => b.leaveTypeId === annualTypeId,
        ),
      ).toMatchObject({ pending: 3, available: 17 });

      const queue = (
        await http()
          .get(`${BASE}/leave/requests/pending`)
          .set(auth(managerToken))
          .expect(200)
      ).body;
      expect(queue.map((r: { id: string }) => r.id)).toEqual([requestId]);
    });

    it('overlapping request is refused; employee cannot approve their own', async () => {
      await http()
        .post(`${BASE}/leave/requests`)
        .set(auth(employeeToken))
        .send({
          leaveTypeId: annualTypeId,
          startDate: addDays(monday, 2),
          endDate: addDays(monday, 3),
        })
        .expect(409);
      await http()
        .post(`${BASE}/leave/requests/${requestId}/approve`)
        .set(auth(employeeToken))
        .send({})
        .expect(403);
    });

    it('manager approves: pending → used, employee notified, request visible in team calendar', async () => {
      const res = await http()
        .post(`${BASE}/leave/requests/${requestId}/approve`)
        .set(auth(managerToken))
        .send({ note: 'ok' })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'APPROVED',
        decisionNote: 'ok',
      });

      const balances = (
        await http()
          .get(`${BASE}/leave/balances/${employeeId}`)
          .set(auth(managerToken))
          .expect(200)
      ).body;
      expect(
        balances.find(
          (b: { leaveTypeId: string }) => b.leaveTypeId === annualTypeId,
        ),
      ).toMatchObject({ pending: 0, used: 3, available: 17 });

      const team = (
        await http()
          .get(
            `${BASE}/leave/requests/team?from=${monday}&to=${addDays(monday, 30)}`,
          )
          .set(auth(managerToken))
          .expect(200)
      ).body;
      expect(team.data.map((r: { id: string }) => r.id)).toEqual([requestId]);

      const log = await ds.query(
        `SELECT COUNT(*)::int AS n FROM notification_log WHERE template = 'LEAVE_DECIDED'`,
      );
      expect(log[0].n).toBeGreaterThan(0);
    });

    it('employee cancels the approved future leave; days come back', async () => {
      await http()
        .post(`${BASE}/leave/requests/${requestId}/cancel`)
        .set(auth(employeeToken))
        .send({})
        .expect(201);
      const balances = (
        await http().get(`${BASE}/leave/balances/me`).set(auth(employeeToken))
      ).body;
      expect(
        balances.find(
          (b: { leaveTypeId: string }) => b.leaveTypeId === annualTypeId,
        ),
      ).toMatchObject({ used: 0, available: 20 });
    });

    it('half-day and holiday handling; HR adjustment is audited', async () => {
      await http()
        .post(`${BASE}/leave/holidays`)
        .set(auth(admin))
        .send({ date: addDays(monday, 7), name: 'Founders Day' })
        .expect(201);
      const res = await http()
        .post(`${BASE}/leave/requests`)
        .set(auth(employeeToken))
        .send({
          leaveTypeId: annualTypeId,
          startDate: addDays(monday, 7),
          endDate: addDays(monday, 9),
        }) // holiday Mon + Tue + Wed = 2
        .expect(201);
      expect(res.body.days).toBe(2);
      await http()
        .post(`${BASE}/leave/requests/${res.body.id}/reject`)
        .set(auth(managerToken))
        .send({ note: 'later' })
        .expect(201);

      const half = await http()
        .post(`${BASE}/leave/requests`)
        .set(auth(employeeToken))
        .send({
          leaveTypeId: annualTypeId,
          startDate: addDays(monday, 14),
          endDate: addDays(monday, 14),
          halfDay: 'PM',
        })
        .expect(201);
      expect(half.body.days).toBe(0.5);

      await http()
        .post(`${BASE}/leave/balances/adjust`)
        .set(auth(admin))
        .send({
          employeeId,
          leaveTypeId: annualTypeId,
          year: Number(monday.slice(0, 4)),
          delta: 2,
          reason: 'Overtime comp',
        })
        .expect(201);
      const [{ n }] = await ds.query(
        `SELECT COUNT(*)::int AS n FROM leave_balance_adjustments`,
      );
      expect(n).toBe(1);
      await http()
        .post(`${BASE}/leave/requests/${half.body.id}/cancel`)
        .set(auth(employeeToken))
        .send({})
        .expect(201);
    });

    it('long leave approved by HR while in progress flips status to ON_LEAVE', async () => {
      const start = addDays(monday, -14); // already started
      const res = await http()
        .post(`${BASE}/leave/requests/on-behalf`)
        .set(auth(admin))
        .send({
          employeeId,
          leaveTypeId: annualTypeId,
          startDate: start,
          endDate: addDays(start, 34),
        })
        .expect(201);
      await http()
        .post(`${BASE}/leave/requests/${res.body.id}/approve`)
        .set(auth(admin))
        .send({})
        .expect(201);

      const emp = (
        await http().get(`${BASE}/employees/${employeeId}`).set(auth(admin))
      ).body;
      expect(emp.status).toBe('ON_LEAVE');
      await http()
        .post(`${BASE}/leave/requests/${res.body.id}/cancel`)
        .set(auth(admin))
        .send({ note: 'test cleanup' })
        .expect(201);
      expect(
        (await http().get(`${BASE}/employees/${employeeId}`).set(auth(admin)))
          .body.status,
      ).toBe('ACTIVE');
    });
  });

  describe('attendance', () => {
    it('clock in / out; double clock-in refused; daily totals; manager report scoped to reports', async () => {
      await http()
        .post(`${BASE}/attendance/clock-in`)
        .set(auth(employeeToken))
        .send({})
        .expect(201);
      await http()
        .post(`${BASE}/attendance/clock-in`)
        .set(auth(employeeToken))
        .send({})
        .expect(409);
      const out = (
        await http()
          .post(`${BASE}/attendance/clock-out`)
          .set(auth(employeeToken))
          .send({ note: 'bye' })
          .expect(201)
      ).body;
      expect(out.clockOut).toBeTruthy();

      const me = (
        await http()
          .get(`${BASE}/attendance/me`)
          .set(auth(employeeToken))
          .expect(200)
      ).body;
      expect(me.openSession).toBeNull();
      expect(me.daily).toHaveLength(1);

      const month = new Date().toISOString().slice(0, 7);
      const report = (
        await http()
          .get(`${BASE}/attendance/report?month=${month}`)
          .set(auth(managerToken))
          .expect(200)
      ).body;
      expect(report.map((r: { employeeId: string }) => r.employeeId)).toEqual([
        employeeId,
      ]);
      expect(report[0].daysPresent).toBe(1);

      await http()
        .get(`${BASE}/attendance/report?month=${month}`)
        .set(auth(employeeToken))
        .expect(403);
    });

    it('HR manual record + correction', async () => {
      const rec = (
        await http()
          .post(`${BASE}/attendance/records`)
          .set(auth(admin))
          .send({
            employeeId,
            clockIn: '2026-09-01T08:00:00Z',
            clockOut: '2026-09-01T12:00:00Z',
            note: 'site visit',
          })
          .expect(201)
      ).body;
      expect(rec).toMatchObject({ workedMinutes: 240, source: 'MANUAL' });
      const fixed = (
        await http()
          .patch(`${BASE}/attendance/records/${rec.id}`)
          .set(auth(admin))
          .send({ clockOut: '2026-09-01T13:00:00Z' })
          .expect(200)
      ).body;
      expect(fixed.workedMinutes).toBe(300);
      await http()
        .delete(`${BASE}/attendance/records/${rec.id}`)
        .set(auth(admin))
        .expect(204);
    });
  });
});
