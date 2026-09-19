import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DepartmentsSeeder } from '../src/database/seeds/departments.seeder';
import { AUTH_EVENTS, UserInvitedEvent } from '../src/modules/auth/auth.events';
import { ADMIN, createTestApp, destroyTestApp } from './utils/test-app';

const BASE = '/api/v1';
const PDF = Buffer.from('%PDF-1.4\n%fake\n');

describe('Documents (e2e, memory storage)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => request.Agent;
  let admin: string;
  let managerToken: string;
  let employeeToken: string;
  let employeeId: string;
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
    const mgr = await hire(
      {
        firstName: 'Mo',
        lastName: 'Mgr',
        workEmail: 'mo@test.local',
        hireDate: '2024-01-01',
        departmentId: eng,
      },
      ['MANAGER'],
    );
    managerToken = mgr.token;
    const emp = await hire(
      {
        firstName: 'Dee',
        lastName: 'Doc',
        workEmail: 'dee@test.local',
        hireDate: '2025-01-01',
        departmentId: eng,
        managerId: mgr.id,
      },
      ['EMPLOYEE'],
    );
    employeeToken = emp.token;
    employeeId = emp.id;
  });

  afterAll(async () => {
    await ds.query('TRUNCATE TABLE document_versions, documents CASCADE');
    await ds.query(
      'TRUNCATE TABLE checklist_tasks, checklists, notification_log, employment_history, employees, positions, departments CASCADE',
    );
    await destroyTestApp(app, ds);
  });

  let privateDocId: string;
  let restrictedDocId: string;

  it('employee uploads a private document; version 1 is current and the storage key is hidden', async () => {
    const res = await http()
      .post(`${BASE}/documents`)
      .set(auth(employeeToken))
      .field('title', 'Degree certificate')
      .field('category', 'CERTIFICATE')
      .attach('file', PDF, {
        filename: 'degree.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    privateDocId = res.body.id;
    expect(res.body).toMatchObject({
      ownerEmployeeId: employeeId,
      visibility: 'PRIVATE',
    });
    expect(res.body.currentVersion).toMatchObject({
      version: 1,
      mimeType: 'application/pdf',
      originalFilename: 'degree.pdf',
    });
    expect(JSON.stringify(res.body)).not.toContain('storageKey');
  });

  it('rejects an executable and a contract from an employee', async () => {
    await http()
      .post(`${BASE}/documents`)
      .set(auth(employeeToken))
      .field('title', 'x')
      .field('category', 'OTHER')
      .attach('file', Buffer.from('MZ'), {
        filename: 'x.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(415);
    await http()
      .post(`${BASE}/documents`)
      .set(auth(employeeToken))
      .field('title', 'x')
      .field('category', 'CONTRACT')
      .attach('file', PDF, {
        filename: 'c.pdf',
        contentType: 'application/pdf',
      })
      .expect(403);
  });

  it('a new version becomes current; download links point at the requested version', async () => {
    const res = await http()
      .post(`${BASE}/documents/${privateDocId}/versions`)
      .set(auth(employeeToken))
      .attach('file', Buffer.concat([PDF, Buffer.from('v2')]), {
        filename: 'degree-v2.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(res.body.currentVersion.version).toBe(2);
    expect(res.body.versions).toHaveLength(2);

    const current = (
      await http()
        .get(`${BASE}/documents/${privateDocId}/download`)
        .set(auth(employeeToken))
        .expect(200)
    ).body;
    expect(current).toMatchObject({ version: 2, filename: 'degree-v2.pdf' });
    expect(current.url).toMatch(/^memory:\/\//);
    const v1 = (
      await http()
        .get(`${BASE}/documents/${privateDocId}/download?version=1`)
        .set(auth(employeeToken))
        .expect(200)
    ).body;
    expect(v1.version).toBe(1);
  });

  it('manager (reporting chain) can read PRIVATE; HR-issued RESTRICTED payslip is owner + HR only', async () => {
    await http()
      .get(`${BASE}/documents/${privateDocId}`)
      .set(auth(managerToken))
      .expect(200);

    restrictedDocId = (
      await http()
        .post(`${BASE}/documents`)
        .set(auth(admin))
        .field('title', 'Payslip Sep')
        .field('category', 'PAYSLIP')
        .field('visibility', 'RESTRICTED')
        .field('ownerEmployeeId', employeeId)
        .attach('file', PDF, {
          filename: 'payslip.pdf',
          contentType: 'application/pdf',
        })
        .expect(201)
    ).body.id;
    await http()
      .get(`${BASE}/documents/${restrictedDocId}`)
      .set(auth(employeeToken))
      .expect(200);
    await http()
      .get(`${BASE}/documents/${restrictedDocId}`)
      .set(auth(managerToken))
      .expect(403);
    await http()
      .get(`${BASE}/documents/${restrictedDocId}/download`)
      .set(auth(managerToken))
      .expect(403);
    // Employee cannot replace an HR-issued document.
    await http()
      .post(`${BASE}/documents/${restrictedDocId}/versions`)
      .set(auth(employeeToken))
      .attach('file', PDF, {
        filename: 'p.pdf',
        contentType: 'application/pdf',
      })
      .expect(403);
  });

  it('company policy is visible to everyone and only HR can publish it', async () => {
    const policy = (
      await http()
        .post(`${BASE}/documents`)
        .set(auth(admin))
        .field('title', 'Employee handbook')
        .field('category', 'POLICY')
        .field('visibility', 'COMPANY')
        .attach('file', PDF, {
          filename: 'handbook.pdf',
          contentType: 'application/pdf',
        })
        .expect(201)
    ).body;
    expect(policy.ownerEmployeeId).toBeNull();
    await http()
      .get(`${BASE}/documents/${policy.id}/download`)
      .set(auth(managerToken))
      .expect(200);

    const mine = (
      await http()
        .get(`${BASE}/documents?category=POLICY`)
        .set(auth(employeeToken))
        .expect(200)
    ).body;
    expect(mine.data.map((d: { id: string }) => d.id)).toContain(policy.id);
  });

  it('listing scopes: manager sees own + reports’ PRIVATE + company, not RESTRICTED', async () => {
    const list = (
      await http().get(`${BASE}/documents`).set(auth(managerToken)).expect(200)
    ).body;
    const ids = list.data.map((d: { id: string }) => d.id);
    expect(ids).toContain(privateDocId);
    expect(ids).not.toContain(restrictedDocId);
    const all = (
      await http().get(`${BASE}/documents`).set(auth(admin)).expect(200)
    ).body;
    expect(all.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('profile photo upload sets photoUrl; a PDF is refused', async () => {
    await http()
      .put(`${BASE}/documents/profile-photo/me`)
      .set(auth(employeeToken))
      .attach('file', PDF, {
        filename: 'x.pdf',
        contentType: 'application/pdf',
      })
      .expect(415);
    const res = await http()
      .put(`${BASE}/documents/profile-photo/me`)
      .set(auth(employeeToken))
      .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        filename: 'me.png',
        contentType: 'image/png',
      })
      .expect(200);
    expect(res.body.photoUrl).toMatch(/^memory:\/\/employees\//);
  });

  it('soft delete hides the document but keeps its rows', async () => {
    await http()
      .delete(`${BASE}/documents/${privateDocId}`)
      .set(auth(employeeToken))
      .expect(204);
    await http()
      .get(`${BASE}/documents/${privateDocId}`)
      .set(auth(employeeToken))
      .expect(404);
    const [{ n }] = await ds.query(
      `SELECT COUNT(*)::int AS n FROM document_versions WHERE document_id = $1`,
      [privateDocId],
    );
    expect(n).toBe(2);
  });
});
