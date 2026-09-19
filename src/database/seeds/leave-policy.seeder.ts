import type { DataSource } from 'typeorm';
import { LeaveType } from '../../modules/leave/entities/leave-type.entity';
import { PublicHoliday } from '../../modules/leave/entities/public-holiday.entity';
import type { Seeder } from './seeder.interface';

const TYPES: Partial<LeaveType>[] = [
  {
    code: 'ANNUAL',
    name: 'Annual leave',
    defaultDays: 20,
    carryOverMaxDays: 5,
    carryOverExpiresOn: '03-31',
    sortOrder: 0,
  },
  { code: 'SICK', name: 'Sick leave', defaultDays: 10, sortOrder: 1 },
  {
    code: 'UNPAID',
    name: 'Unpaid leave',
    defaultDays: 0,
    isPaid: false,
    requiresBalance: false,
    sortOrder: 2,
  },
  {
    code: 'MATERNITY',
    name: 'Maternity leave',
    defaultDays: 90,
    allowHalfDay: false,
    sortOrder: 3,
  },
  {
    code: 'PATERNITY',
    name: 'Paternity leave',
    defaultDays: 10,
    allowHalfDay: false,
    sortOrder: 4,
  },
  {
    code: 'COMPASSIONATE',
    name: 'Compassionate leave',
    defaultDays: 5,
    sortOrder: 5,
  },
];

/** Fixed-date holidays for the current and next year; edit under /leave/holidays. */
const HOLIDAYS: { md: string; name: string }[] = [
  { md: '01-01', name: "New Year's Day" },
  { md: '05-01', name: 'Workers’ Day' },
  { md: '12-25', name: 'Christmas Day' },
  { md: '12-26', name: 'Boxing Day' },
];

/** Default leave policy. Idempotent by leave-type code and holiday date. */
export class LeavePolicySeeder implements Seeder {
  readonly name = 'leave types & holidays';

  async run(ds: DataSource): Promise<void> {
    const types = ds.getRepository(LeaveType);
    for (const t of TYPES) {
      if (await types.exists({ where: { code: t.code } })) continue;
      await types.save(
        types.create({
          description: null,
          isPaid: true,
          requiresBalance: true,
          carryOverMaxDays: 0,
          carryOverExpiresOn: null,
          allowHalfDay: true,
          isActive: true,
          ...t,
        }),
      );
    }

    const holidays = ds.getRepository(PublicHoliday);
    const year = new Date().getUTCFullYear();
    for (const y of [year, year + 1]) {
      for (const h of HOLIDAYS) {
        const date = `${y}-${h.md}`;
        if (await holidays.exists({ where: { date } })) continue;
        await holidays.save(holidays.create({ date, name: h.name }));
      }
    }
  }
}
