import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ChecklistTemplatesSeeder } from '../src/database/seeds/checklist-templates.seeder';
import { DepartmentsSeeder } from '../src/database/seeds/departments.seeder';
import { AUTH_EVENTS, UserInvitedEvent } from '../src/modules/auth/auth.events';
import { ONBOARDING_EVENTS } from '../src/modules/onboarding/onboarding.service';
import { ADMIN, createTestApp, destroyTestApp } from './utils/test-app';

const BASE = '/api/v1';

describe('Onboarding (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => request.Agent;
  let admin: string;
  let eng: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.WORKERS_ENABLED = 'true';
    ({ app, ds } = await createTestApp());
    await new DepartmentsSeeder().run(ds);
    await new ChecklistTemplatesSeeder().run(ds);
    http = () => request(app.getHttpServer());
    admin = (
      await http()
        .post(`${BASE}/auth/login`)
        .send({ email: ADMIN.email, password: ADMIN.password })
        .expect(200)
    ).body.accessToken;
    const depts = (await http().get(`${BASE}/departments`).set(auth(admin)))
      .body;
    eng = depts.find((d: { code: string }) => d.code === 'ENG').id;
  });

  afterAll(async () => {
    await ds.query(
      'TRUNCATE TABLE checklist_tasks, checklists, checklist_template_items, checklist_templates CASCADE',
    );
    await ds.query(
      'TRUNCATE TABLE notification_log, employment_history, employees, positions, departments CASCADE',
    );
    await destroyTestApp(app, ds);
  });

  it('seeded templates are listed', async () => {
    const list = (
      await http()
        .get(`${BASE}/checklist-templates`)
        .set(auth(admin))
        .expect(200)
    ).body;
    expect(list.map((t: { type: string }) => t.type).sort()).toEqual([
      'OFFBOARDING',
      'ONBOARDING',
    ]);
    expect(
      list.find((t: { type: string }) => t.type === 'ONBOARDING').items.length,
    ).toBeGreaterThan(3);
  });

  describe('hire → checklist → completion → ACTIVE', () => {
    let employeeId: string;
    let employeeToken: string;
    let checklistId: string;

    it('hiring starts an onboarding checklist automatically with resolved assignees', async () => {
      const invited = new Promise<UserInvitedEvent>((r) =>
        app.get(EventEmitter2).once(AUTH_EVENTS.USER_INVITED, r),
      );
      const started = new Promise<{ checklistId: string }>((r) =>
        app.get(EventEmitter2).once(ONBOARDING_EVENTS.CHECKLIST_STARTED, r),
      );

      const res = await http()
        .post(`${BASE}/employees`)
        .set(auth(admin))
        .send({
          firstName: 'Nia',
          lastName: 'New',
          workEmail: 'nia@test.local',
          hireDate: '2026-11-01',
          departmentId: eng,
          inviteLogin: { roles: ['EMPLOYEE'] },
        })
        .expect(201);
      employeeId = res.body.id;
      expect(res.body.status).toBe('ONBOARDING');

      checklistId = (await started).checklistId;
      const { inviteToken } = await invited;
      employeeToken = (
        await http()
          .post(`${BASE}/auth/accept-invite`)
          .send({ token: inviteToken, password: 'Nia-Pass-123' })
          .expect(200)
      ).body.accessToken;

      const c = (
        await http()
          .get(`${BASE}/checklists/${checklistId}`)
          .set(auth(admin))
          .expect(200)
      ).body;
      expect(c.type).toBe('ONBOARDING');
      expect(c.anchorDate).toBe('2026-11-01');
      const contract = c.tasks.find(
        (t: { title: string }) => t.title === 'Sign employment contract',
      );
      expect(contract.dueDate).toBe('2026-10-29');
      expect(contract.assigneeUserId).toBe(res.body.userId);
      const laptop = c.tasks.find((t: { title: string }) =>
        t.title.startsWith('Provision'),
      );
      expect(laptop).toMatchObject({
        assigneeUserId: null,
        assigneeRoleName: 'HR_MANAGER',
      });
    });

    it('the employee sees their own checklist and tasks; cannot touch an HR task', async () => {
      const mine = (
        await http()
          .get(`${BASE}/checklists/me`)
          .set(auth(employeeToken))
          .expect(200)
      ).body;
      expect(mine[0].id).toBe(checklistId);

      const myTasks = (
        await http()
          .get(`${BASE}/checklists/tasks/me`)
          .set(auth(employeeToken))
          .expect(200)
      ).body;
      expect(
        myTasks.every((t: { assigneeUserId: string }) => t.assigneeUserId),
      ).toBe(true);
      expect(myTasks.length).toBeGreaterThan(0);

      const c = (
        await http()
          .get(`${BASE}/checklists/${checklistId}`)
          .set(auth(employeeToken))
          .expect(200)
      ).body;
      const hrTask = c.tasks.find(
        (t: { assigneeRoleName: string }) =>
          t.assigneeRoleName === 'HR_MANAGER',
      );
      await http()
        .patch(`${BASE}/checklists/tasks/${hrTask.id}`)
        .set(auth(employeeToken))
        .send({ status: 'DONE' })
        .expect(403);
    });

    it('completing every required task flips the checklist to COMPLETED and the employee to ACTIVE', async () => {
      const c = (
        await http().get(`${BASE}/checklists/${checklistId}`).set(auth(admin))
      ).body;
      for (const t of c.tasks.filter(
        (t: { isRequired: boolean }) => t.isRequired,
      )) {
        const token =
          t.assigneeUserId === c.employee.userId ? employeeToken : admin;
        await http()
          .patch(`${BASE}/checklists/tasks/${t.id}`)
          .set(auth(token))
          .send({ status: 'DONE' })
          .expect(200);
      }

      const done = (
        await http().get(`${BASE}/checklists/${checklistId}`).set(auth(admin))
      ).body;
      expect(done.status).toBe('COMPLETED');
      expect(done.progress.requiredDone).toBe(done.progress.required);

      const emp = (
        await http().get(`${BASE}/employees/${employeeId}`).set(auth(admin))
      ).body;
      expect(emp.status).toBe('ACTIVE');
      const history = (
        await http()
          .get(`${BASE}/employees/${employeeId}/history`)
          .set(auth(admin))
      ).body;
      expect(history[0]).toMatchObject({
        changeType: 'STATUS_CHANGE',
        toStatus: 'ACTIVE',
      });

      // Optional task on a completed checklist can no longer be edited.
      const optional = done.tasks.find(
        (t: { isRequired: boolean }) => !t.isRequired,
      );
      await http()
        .patch(`${BASE}/checklists/tasks/${optional.id}`)
        .set(auth(admin))
        .send({ status: 'DONE' })
        .expect(400);
    });

    it('termination starts an offboarding checklist anchored on the last day', async () => {
      await http()
        .post(`${BASE}/employees/${employeeId}/terminate`)
        .set(auth(admin))
        .send({ terminationDate: '2027-03-31' })
        .expect(201);
      await new Promise((r) => setTimeout(r, 300));

      const list = (
        await http()
          .get(`${BASE}/checklists?employeeId=${employeeId}&type=OFFBOARDING`)
          .set(auth(admin))
      ).body;
      expect(list.data).toHaveLength(1);
      const c = (
        await http()
          .get(`${BASE}/checklists/${list.data[0].id}`)
          .set(auth(admin))
      ).body;
      expect(c.anchorDate).toBe('2027-03-31');
      expect(
        c.tasks.find((t: { title: string }) => t.title === 'Handover document')
          .dueDate,
      ).toBe('2027-03-26');
    });
  });

  describe('reminders', () => {
    it('queues a digest for overdue tasks and stamps last_reminded_at', async () => {
      // Backdate the offboarding task due dates so they are overdue.
      await ds.query(
        `UPDATE checklist_tasks SET due_date = CURRENT_DATE - 1 WHERE status = 'PENDING'`,
      );
      await http()
        .post(`${BASE}/checklists/reminders/run`)
        .set(auth(admin))
        .expect(202);

      const started = Date.now();
      let rows: { count: string }[] = [];
      while (Date.now() - started < 10_000) {
        rows = await ds.query(
          `SELECT COUNT(*)::text AS count FROM notification_log WHERE template = 'TASKS_DUE'`,
        );
        if (Number(rows[0].count) > 0) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(Number(rows[0].count)).toBeGreaterThan(0);
      const [{ stamped }] = await ds.query(
        `SELECT COUNT(*)::text AS stamped FROM checklist_tasks WHERE last_reminded_at IS NOT NULL AND assignee_user_id IS NOT NULL`,
      );
      expect(Number(stamped)).toBeGreaterThan(0);
    });
  });
});
