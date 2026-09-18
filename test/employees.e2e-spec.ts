import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DepartmentsSeeder } from '../src/database/seeds/departments.seeder';
import { AUTH_EVENTS, UserInvitedEvent } from '../src/modules/auth/auth.events';
import { ADMIN, createTestApp, destroyTestApp } from './utils/test-app';

const BASE = '/api/v1';

describe('Employees & org (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => request.Agent;
  let admin: string;
  let eng: string; // department id
  let vpPosition: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const login = async (email: string, password: string) =>
    (
      await http()
        .post(`${BASE}/auth/login`)
        .send({ email, password })
        .expect(200)
    ).body.accessToken as string;

  beforeAll(async () => {
    ({ app, ds } = await createTestApp());
    await new DepartmentsSeeder().run(ds);
    http = () => request(app.getHttpServer());
    admin = await login(ADMIN.email, ADMIN.password);

    const depts = (
      await http().get(`${BASE}/departments`).set(auth(admin)).expect(200)
    ).body;
    eng = depts.find((d: { code: string }) => d.code === 'ENG').id;
    const positions = (
      await http().get(`${BASE}/positions?departmentId=${eng}`).set(auth(admin))
    ).body;
    vpPosition = positions.find(
      (p: { title: string }) => p.title === 'VP Engineering',
    ).id;
  });

  afterAll(async () => {
    await ds.query(
      'TRUNCATE TABLE employment_history, employees RESTART IDENTITY CASCADE',
    );
    await ds.query(
      'TRUNCATE TABLE positions, departments RESTART IDENTITY CASCADE',
    );
    await destroyTestApp(app, ds);
  });

  describe('departments', () => {
    it('tree nests children and refuses cycles', async () => {
      const tree = (
        await http()
          .get(`${BASE}/departments/tree`)
          .set(auth(admin))
          .expect(200)
      ).body;
      const exec = tree.find((n: { code: string }) => n.code === 'EXEC');
      expect(exec.children.map((c: { code: string }) => c.code)).toContain(
        'ENG',
      );

      const platform = exec.children
        .find((c: { code: string }) => c.code === 'ENG')
        .children.find((c: { code: string }) => c.code === 'ENG_PLAT');
      // Move ENG under its own child → 400
      await http()
        .patch(`${BASE}/departments/${eng}`)
        .set(auth(admin))
        .send({ parentId: platform.id })
        .expect(400);
    });

    it('cannot delete a department with children', async () => {
      await http()
        .delete(`${BASE}/departments/${eng}`)
        .set(auth(admin))
        .expect(409);
    });
  });

  describe('hire → org → terminate', () => {
    let vp: string;
    let engineer: string;
    let vpToken: string;
    let engineerToken: string;

    it('hires a VP with an invited login', async () => {
      const invited = new Promise<UserInvitedEvent>((r) =>
        app.get(EventEmitter2).once(AUTH_EVENTS.USER_INVITED, r),
      );
      const res = await http()
        .post(`${BASE}/employees`)
        .set(auth(admin))
        .send({
          firstName: 'Vera',
          lastName: 'Lead',
          workEmail: 'vera@test.local',
          hireDate: '2026-01-01',
          status: 'ACTIVE',
          departmentId: eng,
          positionId: vpPosition,
          phone: '+1000',
          inviteLogin: { roles: ['MANAGER'] },
        })
        .expect(201);
      vp = res.body.id;
      expect(res.body.employeeNumber).toMatch(/^EMP-\d{4}$/);
      expect(res.body.userId).toBeTruthy();

      const { inviteToken } = await invited;
      vpToken = (
        await http()
          .post(`${BASE}/auth/accept-invite`)
          .send({ token: inviteToken, password: 'Vera-Pass-1' })
          .expect(200)
      ).body.accessToken;
    });

    it('hires an engineer reporting to the VP', async () => {
      const invited = new Promise<UserInvitedEvent>((r) =>
        app.get(EventEmitter2).once(AUTH_EVENTS.USER_INVITED, r),
      );
      const res = await http()
        .post(`${BASE}/employees`)
        .set(auth(admin))
        .send({
          firstName: 'Eli',
          lastName: 'Code',
          workEmail: 'eli@test.local',
          hireDate: '2026-02-01',
          departmentId: eng,
          managerId: vp,
          personalEmail: 'eli@home.test',
          inviteLogin: { roles: ['EMPLOYEE'] },
        })
        .expect(201);
      engineer = res.body.id;
      expect(res.body.status).toBe('ONBOARDING');
      const { inviteToken } = await invited;
      engineerToken = (
        await http()
          .post(`${BASE}/auth/accept-invite`)
          .send({ token: inviteToken, password: 'Eli-Pass-12' })
          .expect(200)
      ).body.accessToken;
    });

    it('employee sees own full record; sees the VP only as directory (no personal fields)', async () => {
      const me = (
        await http()
          .get(`${BASE}/employees/me`)
          .set(auth(engineerToken))
          .expect(200)
      ).body;
      expect(me.personalEmail).toBe('eli@home.test');

      const boss = (
        await http()
          .get(`${BASE}/employees/${vp}`)
          .set(auth(engineerToken))
          .expect(200)
      ).body;
      expect(boss.workEmail).toBe('vera@test.local');
      expect(boss).not.toHaveProperty('phone');
      expect(boss).not.toHaveProperty('userId');

      await http()
        .get(`${BASE}/employees/${vp}/history`)
        .set(auth(engineerToken))
        .expect(403);
    });

    it('manager sees full record + history of their report via the reporting chain', async () => {
      const report = (
        await http()
          .get(`${BASE}/employees/${engineer}`)
          .set(auth(vpToken))
          .expect(200)
      ).body;
      expect(report.personalEmail).toBe('eli@home.test');

      const team = (
        await http()
          .get(`${BASE}/employees/me/team`)
          .set(auth(vpToken))
          .expect(200)
      ).body;
      expect(team.map((e: { id: string }) => e.id)).toEqual([engineer]);

      const history = (
        await http()
          .get(`${BASE}/employees/${engineer}/history`)
          .set(auth(vpToken))
          .expect(200)
      ).body;
      expect(history[0].changeType).toBe('HIRE');
    });

    it('employee cannot hire, HR-only endpoints 403', async () => {
      await http()
        .post(`${BASE}/employees`)
        .set(auth(engineerToken))
        .send({})
        .expect(403);
      await http()
        .post(`${BASE}/employees/${vp}/terminate`)
        .set(auth(vpToken))
        .send({ terminationDate: '2027-01-01' })
        .expect(403);
    });

    it('org chart nests the engineer under the VP', async () => {
      const chart = (
        await http()
          .get(`${BASE}/employees/org-chart`)
          .set(auth(engineerToken))
          .expect(200)
      ).body;
      const vpNode = chart.find((n: { id: string }) => n.id === vp);
      expect(vpNode.position).toBe('VP Engineering');
      expect(vpNode.children.map((c: { id: string }) => c.id)).toEqual([
        engineer,
      ]);
    });

    it('promotion writes history; reporting cycle is refused', async () => {
      await http()
        .post(`${BASE}/employees/${engineer}/assignments`)
        .set(auth(admin))
        .send({
          changeType: 'PROMOTION',
          effectiveDate: '2026-06-01',
          positionId: vpPosition,
          notes: 'Great work',
        })
        .expect(201);
      const history = (
        await http()
          .get(`${BASE}/employees/${engineer}/history`)
          .set(auth(admin))
      ).body;
      expect(history[0]).toMatchObject({
        changeType: 'PROMOTION',
        toPosition: { title: 'VP Engineering' },
      });

      await http()
        .post(`${BASE}/employees/${vp}/assignments`)
        .set(auth(admin))
        .send({
          changeType: 'MANAGER_CHANGE',
          effectiveDate: '2026-06-01',
          managerId: engineer,
        })
        .expect(400);
    });

    it('ONBOARDING → ACTIVE via status endpoint', async () => {
      const res = await http()
        .put(`${BASE}/employees/${engineer}/status`)
        .set(auth(admin))
        .send({ status: 'ACTIVE', effectiveDate: '2026-02-15' })
        .expect(200);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('terminating the VP moves the engineer up and suspends the VP login', async () => {
      await http()
        .post(`${BASE}/employees/${vp}/terminate`)
        .set(auth(admin))
        .send({ terminationDate: '2026-12-31', reason: 'Left' })
        .expect(201);

      const eng2 = (
        await http().get(`${BASE}/employees/${engineer}`).set(auth(admin))
      ).body;
      expect(eng2.managerId).toBeNull(); // VP had no manager

      await http().get(`${BASE}/employees/me`).set(auth(vpToken)).expect(401);
      const list = (await http().get(`${BASE}/employees`).set(auth(admin)))
        .body;
      expect(list.data.map((e: { id: string }) => e.id)).not.toContain(vp);
      const withTerminated = (
        await http()
          .get(`${BASE}/employees?includeTerminated=true`)
          .set(auth(admin))
      ).body;
      expect(withTerminated.data.map((e: { id: string }) => e.id)).toContain(
        vp,
      );
    });
  });
});
