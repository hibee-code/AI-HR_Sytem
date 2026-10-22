/**
 * `npm run seed:demo` — a realistic company to click through before the
 * frontend exists: ~10 people across every role with a reporting line,
 * salary structures, leave requests, a company policy (indexed for the AI
 * assistant) and an open job. Idempotent: skips if the demo HR user exists.
 *
 * Goes through the real services (not SQL) so every business rule and side
 * effect applies — onboarding checklists, balances, audit, AI indexing. Jobs
 * are queued for the running app's workers; start the API to process them.
 */
import '../../cli/no-workers.env'; // must stay first
import type { INestApplicationContext, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { addDays, todayIso } from '../../common/utils/date';
import { DocumentsService } from '../../modules/documents/documents.service';
import {
  DocumentCategory,
  DocumentVisibility,
} from '../../modules/documents/entities/document.entity';
import { DepartmentsService } from '../../modules/employees/departments.service';
import { EmployeesService } from '../../modules/employees/employees.service';
import { EmployeeStatus } from '../../modules/employees/entities/employee.entity';
import { LeavePolicyService } from '../../modules/leave/leave-policy.service';
import { LeaveRequestsService } from '../../modules/leave/leave-requests.service';
import {
  LineMethod,
  LineType,
} from '../../modules/payroll/entities/salary-structure.entity';
import { PayrollService } from '../../modules/payroll/payroll.service';
import { RbacService } from '../../modules/rbac/rbac.service';
import { OpeningStatus } from '../../modules/recruiting/entities/job-opening.entity';
import { RecruitingService } from '../../modules/recruiting/recruiting.service';
import { UserStatus } from '../../modules/users/entities/user.entity';
import { UsersService } from '../../modules/users/users.service';
import { AdminUserSeeder } from './admin-user.seeder';
import { ChecklistTemplatesSeeder } from './checklist-templates.seeder';
import { DepartmentsSeeder } from './departments.seeder';
import { LeavePolicySeeder } from './leave-policy.seeder';
import { RolesPermissionsSeeder } from './roles-permissions.seeder';

const DOMAIN = 'demo.local';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'DemoPassw0rd!';

interface Person {
  key: string;
  first: string;
  last: string;
  dept: string;
  roles: string[];
  manager?: string;
  hireDate: string;
  base: number; // monthly basic, NGN
  status?: EmployeeStatus.ONBOARDING;
}

const PEOPLE: Person[] = [
  {
    key: 'ceo',
    first: 'Adaeze',
    last: 'Nwosu',
    dept: 'EXEC',
    roles: ['MANAGER'],
    hireDate: '2019-02-01',
    base: 2_500_000,
  },
  {
    key: 'hr',
    first: 'Hauwa',
    last: 'Bello',
    dept: 'PEOPLE',
    roles: ['HR_MANAGER'],
    manager: 'ceo',
    hireDate: '2021-03-01',
    base: 1_200_000,
  },
  {
    key: 'eng',
    first: 'Tunde',
    last: 'Adeyemi',
    dept: 'ENG',
    roles: ['MANAGER'],
    manager: 'ceo',
    hireDate: '2020-06-01',
    base: 1_800_000,
  },
  {
    key: 'fin',
    first: 'Chinedu',
    last: 'Okeke',
    dept: 'FIN',
    roles: ['MANAGER'],
    manager: 'ceo',
    hireDate: '2021-09-15',
    base: 1_500_000,
  },
  {
    key: 'dev1',
    first: 'Amaka',
    last: 'Eze',
    dept: 'ENG_PLAT',
    roles: ['EMPLOYEE'],
    manager: 'eng',
    hireDate: '2022-01-10',
    base: 900_000,
  },
  {
    key: 'dev2',
    first: 'Ibrahim',
    last: 'Musa',
    dept: 'ENG_PROD',
    roles: ['EMPLOYEE'],
    manager: 'eng',
    hireDate: '2023-04-03',
    base: 750_000,
  },
  {
    key: 'dev3',
    first: 'Kemi',
    last: 'Afolabi',
    dept: 'ENG_PROD',
    roles: ['EMPLOYEE'],
    manager: 'eng',
    hireDate: '2024-08-19',
    base: 600_000,
  },
  {
    key: 'acct',
    first: 'Yusuf',
    last: 'Garba',
    dept: 'FIN',
    roles: ['EMPLOYEE'],
    manager: 'fin',
    hireDate: '2023-11-01',
    base: 550_000,
  },
  {
    key: 'rec',
    first: 'Ngozi',
    last: 'Okafor',
    dept: 'PEOPLE',
    roles: ['RECRUITER'],
    manager: 'hr',
    hireDate: '2024-02-12',
    base: 650_000,
  },
  // Joined this month: shows onboarding checklists and pro-rated pay.
  {
    key: 'new',
    first: 'Seun',
    last: 'Bakare',
    dept: 'SALES',
    roles: ['EMPLOYEE'],
    manager: 'ceo',
    hireDate: addDays(todayIso(), -6),
    base: 500_000,
    status: EmployeeStatus.ONBOARDING,
  },
];

const LEAVE_POLICY = `# Leave & Attendance Policy

## Annual leave
Every full-time employee is entitled to 20 working days of paid annual leave per calendar year.
Up to 5 unused days may be carried over into the next year and must be used by 31 March.
Requests should be submitted at least two weeks in advance and are approved by your line manager.

## Sick leave
Employees receive 10 days of paid sick leave per year. Absences longer than two consecutive days
require a medical certificate, uploaded to your documents.

## Maternity and paternity leave
Maternity leave is 90 days at full pay. Paternity leave is 10 working days, to be taken within
three months of the birth or adoption.

## Working hours and attendance
Core hours are 9:00 to 16:00, Monday to Friday. Clock in and out through the HR system.
Public holidays declared by the Federal Government are paid days off.
`;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Refusing to seed demo data into production.');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    await seed(app);
  } finally {
    await app.close();
  }
}

async function seed(app: INestApplicationContext): Promise<void> {
  const svc = services(app);
  const ds = app.get(DataSource);
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';

  for (const seeder of [
    new RolesPermissionsSeeder(),
    new AdminUserSeeder(
      adminEmail,
      process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!',
    ),
    new DepartmentsSeeder(),
    new ChecklistTemplatesSeeder(),
    new LeavePolicySeeder(),
  ])
    await seeder.run(ds);
  if (await svc.users.findByEmail(`hr@${DOMAIN}`)) {
    console.log(`Demo data already present (hr@${DOMAIN}); nothing to do.`);
    return;
  }

  const adminUser = await svc.users.findByEmail(adminEmail);
  if (!adminUser) throw new Error(`Admin ${adminEmail} not found`);
  const admin = (await svc.rbac.getAuthUser(adminUser.id))!;

  const depts = new Map(
    (await svc.departments.findAll()).map((d) => [d.code, d.id] as const),
  );
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  // ── People ──────────────────────────────────────────────────────────
  const ids = new Map<string, { employeeId: string; userId: string }>();
  for (const p of PEOPLE) {
    const emp = await svc.employees.create(
      {
        firstName: p.first,
        lastName: p.last,
        workEmail: `${p.key}@${DOMAIN}`,
        hireDate: p.hireDate,
        departmentId: depts.get(p.dept)!,
        managerId: p.manager ? ids.get(p.manager)!.employeeId : undefined,
        status: p.status ?? EmployeeStatus.ACTIVE,
        inviteLogin: { roles: p.roles },
      },
      admin.id,
    );
    // Skip the invite e-mail round-trip: activate with the demo password.
    const user = await svc.users.findByEmail(`${p.key}@${DOMAIN}`);
    Object.assign(user!, {
      passwordHash: hash,
      passwordChangedAt: new Date(),
      status: UserStatus.ACTIVE,
    });
    await svc.users.save(user!);
    await svc.rbac.invalidateAuthUser(user!.id);
    ids.set(p.key, { employeeId: emp.id, userId: user!.id });

    await svc.payroll.createStructure(
      {
        employeeId: emp.id,
        effectiveFrom: p.hireDate > '2026-01-01' ? p.hireDate : '2026-01-01',
        baseAmount: p.base,
        lines: [
          {
            code: 'HOUSING',
            label: 'Housing allowance',
            type: LineType.EARNING,
            method: LineMethod.PERCENT_OF_BASE,
            value: 40,
          },
          {
            code: 'TRANSPORT',
            label: 'Transport allowance',
            type: LineType.EARNING,
            method: LineMethod.FIXED,
            value: 75_000,
          },
        ],
      },
      admin.id,
    );
  }

  // ── Leave: one approved, one pending (Tunde approves his reports) ────
  const annual = (await svc.leavePolicy.findTypes()).find(
    (t) => t.code === 'ANNUAL',
  )!;
  const monday = nextWeekday(1, 14);
  const approved = await svc.leave.submit(
    ids.get('dev1')!.employeeId,
    {
      leaveTypeId: annual.id,
      startDate: monday,
      endDate: addDays(monday, 4),
      reason: 'Family visit',
    },
    ids.get('dev1')!.userId,
  );
  const manager = (await svc.rbac.getAuthUser(ids.get('eng')!.userId))!;
  await svc.leave.approve(approved.id, manager, 'Enjoy!');
  await svc.leave.submit(
    ids.get('dev2')!.employeeId,
    {
      leaveTypeId: annual.id,
      startDate: addDays(monday, 14),
      endDate: addDays(monday, 15),
      reason: 'Wedding',
    },
    ids.get('dev2')!.userId,
  );

  // ── Company policy → AI knowledge base ─────────────────────────────
  const body = Buffer.from(LEAVE_POLICY);
  await svc.documents.createSystemDocument({
    ownerEmployeeId: null,
    title: 'Leave & Attendance Policy',
    category: DocumentCategory.POLICY,
    visibility: DocumentVisibility.COMPANY,
    file: {
      originalname: 'leave-policy.md',
      mimetype: 'text/markdown',
      size: body.length,
      buffer: body,
    },
    createdByUserId: admin.id,
  });

  // ── An open job for résumé screening ────────────────────────────────
  const opening = await svc.recruiting.createOpening(
    {
      title: 'Backend Engineer (Node.js)',
      departmentId: depts.get('ENG_PROD')!,
      description: 'Build and run the APIs behind our HR platform.',
      requirements: [
        '3+ years building production APIs with Node.js and TypeScript',
        'PostgreSQL schema design and query tuning',
        'Experience with queues or background jobs (BullMQ, RabbitMQ, SQS)',
        'Writes automated tests',
      ],
    },
    ids.get('rec')!.userId,
  );
  await svc.recruiting.updateOpening(opening.id, {
    status: OpeningStatus.OPEN,
  });

  printLogins(adminEmail);
}

function services(app: INestApplicationContext) {
  const get = <T>(t: Type<T>) => app.get(t, { strict: false });
  return {
    users: get(UsersService),
    rbac: get(RbacService),
    employees: get(EmployeesService),
    departments: get(DepartmentsService),
    payroll: get(PayrollService),
    leavePolicy: get(LeavePolicyService),
    leave: get(LeaveRequestsService),
    documents: get(DocumentsService),
    recruiting: get(RecruitingService),
  };
}

function printLogins(adminEmail: string): void {
  console.log("\nDemo company ready. Every demo user's password: " + PASSWORD);
  console.log(`  ${'ADMIN'.padEnd(11)} ${adminEmail} (SEED_ADMIN_PASSWORD)`);
  for (const p of PEOPLE) {
    console.log(
      `  ${p.roles[0].padEnd(11)} ${`${p.key}@${DOMAIN}`.padEnd(18)} ${p.first} ${p.last}`,
    );
  }
  console.log(
    '\nStart the API so its workers index the policy and send notifications.',
  );
}

/** The given weekday (1 = Monday) at least `minDays` from today. */
function nextWeekday(weekday: number, minDays: number): string {
  let d = addDays(todayIso(), minDays);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== weekday) d = addDays(d, 1);
  return d;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
