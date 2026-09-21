import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DepartmentsSeeder } from '../src/database/seeds/departments.seeder';
import { AUTH_EVENTS, UserInvitedEvent } from '../src/modules/auth/auth.events';
import { ADMIN, createTestApp, destroyTestApp } from './utils/test-app';

const BASE = '/api/v1';

describe('Payroll (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => request.Agent;
  let admin: string;
  let emp: { id: string; token: string };
  let noPay: { id: string; token: string };
  let runId: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const hire = async (body: Record<string, unknown>) => {
    const invited = new Promise<UserInvitedEvent>((r) =>
      app.get(EventEmitter2).once(AUTH_EVENTS.USER_INVITED, r),
    );
    const res = await http()
      .post(`${BASE}/employees`)
      .set(auth(admin))
      .send({ ...body, status: 'ACTIVE', inviteLogin: { roles: ['EMPLOYEE'] } })
      .expect(201);
    const { inviteToken } = await invited;
    const token = (
      await http()
        .post(`${BASE}/auth/accept-invite`)
        .send({ token: inviteToken, password: 'Pass-word-123' })
    ).body.accessToken;
    return { id: res.body.id as string, token: token as string };
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
    emp = await hire({
      firstName: 'Paid',
      lastName: 'Person',
      workEmail: 'paid@test.local',
      hireDate: '2025-01-01',
      departmentId: eng,
    });
    noPay = await hire({
      firstName: 'No',
      lastName: 'Structure',
      workEmail: 'nopay@test.local',
      hireDate: '2025-01-01',
      departmentId: eng,
    });
  });

  afterAll(async () => {
    await ds.query(
      'TRUNCATE TABLE payslips, payroll_runs, salary_structures, document_versions, documents CASCADE',
    );
    await ds.query(
      'TRUNCATE TABLE checklist_tasks, checklists, notification_log, employment_history, employees, positions, departments CASCADE',
    );
    await destroyTestApp(app, ds);
  });

  it('HR sets a salary structure; a second one closes the first; employee sees their own', async () => {
    await http()
      .post(`${BASE}/payroll/structures`)
      .set(auth(admin))
      .send({
        employeeId: emp.id,
        effectiveFrom: '2026-01-01',
        baseAmount: 500000,
        lines: [
          {
            code: 'HOUSING',
            label: 'Housing',
            type: 'EARNING',
            method: 'PERCENT_OF_BASE',
            value: 20,
          },
        ],
      })
      .expect(201);
    await http()
      .post(`${BASE}/payroll/structures`)
      .set(auth(admin))
      .send({
        employeeId: emp.id,
        effectiveFrom: '2026-07-01',
        baseAmount: 600000,
        lines: [
          {
            code: 'HOUSING',
            label: 'Housing',
            type: 'EARNING',
            method: 'PERCENT_OF_BASE',
            value: 20,
          },
          {
            code: 'PENSION',
            label: 'Pension',
            type: 'DEDUCTION',
            method: 'PERCENT_OF_BASE',
            value: 8,
          },
          {
            code: 'TAX',
            label: 'PAYE',
            type: 'DEDUCTION',
            method: 'PERCENT_OF_GROSS',
            value: 10,
          },
        ],
      })
      .expect(201);

    const mine = (
      await http()
        .get(`${BASE}/payroll/structures/me`)
        .set(auth(emp.token))
        .expect(200)
    ).body;
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({
      baseAmount: 600000,
      effectiveTo: null,
      currency: 'NGN',
    });
    expect(mine[1].effectiveTo).toBe('2026-06-30');
    await http()
      .get(`${BASE}/payroll/structures/employee/${emp.id}`)
      .set(auth(emp.token))
      .expect(403);
  });

  it('run: create → calculate (one paid, one skipped) → employee cannot see yet', async () => {
    runId = (
      await http()
        .post(`${BASE}/payroll/runs`)
        .set(auth(admin))
        .send({
          periodStart: '2026-10-01',
          periodEnd: '2026-10-31',
          payDate: '2026-10-28',
        })
        .expect(201)
    ).body.id;
    const { run, skipped } = (
      await http()
        .post(`${BASE}/payroll/runs/${runId}/calculate`)
        .set(auth(admin))
        .expect(201)
    ).body;
    expect(run.status).toBe('CALCULATED');
    expect(run.totals).toMatchObject({
      employees: 1,
      gross: 720000,
      deductions: 120000,
      net: 600000,
      skipped: 1,
    });
    expect(skipped).toEqual([
      { employeeId: noPay.id, reason: 'no salary structure' },
    ]);

    const mine = (
      await http()
        .get(`${BASE}/payroll/payslips/me`)
        .set(auth(emp.token))
        .expect(200)
    ).body;
    expect(mine.data).toHaveLength(0);
  });

  it('approve: PDF payslip document (RESTRICTED) + notification; employee can view and download', async () => {
    const approved = (
      await http()
        .post(`${BASE}/payroll/runs/${runId}/approve`)
        .set(auth(admin))
        .expect(201)
    ).body;
    expect(approved.status).toBe('APPROVED');

    const mine = (
      await http()
        .get(`${BASE}/payroll/payslips/me`)
        .set(auth(emp.token))
        .expect(200)
    ).body;
    expect(mine.data).toHaveLength(1);
    const slip = (
      await http()
        .get(`${BASE}/payroll/payslips/${mine.data[0].id}`)
        .set(auth(emp.token))
        .expect(200)
    ).body;
    expect(slip).toMatchObject({ net: 600000, currency: 'NGN' });
    expect(slip.documentId).toBeTruthy();

    const doc = (
      await http()
        .get(`${BASE}/documents/${slip.documentId}`)
        .set(auth(emp.token))
        .expect(200)
    ).body;
    expect(doc).toMatchObject({
      category: 'PAYSLIP',
      visibility: 'RESTRICTED',
      ownerEmployeeId: emp.id,
    });
    expect(doc.currentVersion.mimeType).toBe('application/pdf');
    await http()
      .get(`${BASE}/documents/${slip.documentId}/download`)
      .set(auth(emp.token))
      .expect(200);
    await http()
      .get(`${BASE}/documents/${slip.documentId}`)
      .set(auth(noPay.token))
      .expect(403);

    const [{ n }] = await ds.query(
      `SELECT COUNT(*)::int AS n FROM notification_log WHERE template = 'PAYSLIP_AVAILABLE'`,
    );
    expect(n).toBe(1);

    await http()
      .post(`${BASE}/payroll/runs/${runId}/calculate`)
      .set(auth(admin))
      .expect(400);
    await http()
      .delete(`${BASE}/payroll/runs/${runId}`)
      .set(auth(admin))
      .expect(400);
    await http()
      .post(`${BASE}/payroll/runs/${runId}/mark-paid`)
      .set(auth(admin))
      .expect(201);
  });

  it('overlapping non-draft runs are refused', async () => {
    await http()
      .post(`${BASE}/payroll/runs`)
      .set(auth(admin))
      .send({
        periodStart: '2026-10-15',
        periodEnd: '2026-11-14',
        payDate: '2026-11-10',
      })
      .expect(400);
  });
});
