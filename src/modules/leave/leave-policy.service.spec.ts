import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Employee } from '../employees/entities/employee.entity';
import { LeaveBalanceAdjustment } from './entities/leave-balance-adjustment.entity';
import { LeaveBalance } from './entities/leave-balance.entity';
import { HalfDay } from './entities/leave-request.entity';
import { LeaveType } from './entities/leave-type.entity';
import { PublicHoliday } from './entities/public-holiday.entity';
import { LeavePolicyService, isWeekend, proRate } from './leave-policy.service';

describe('leave arithmetic helpers', () => {
  it('isWeekend', () => {
    expect(isWeekend('2026-09-19')).toBe(true); // Saturday
    expect(isWeekend('2026-09-20')).toBe(true); // Sunday
    expect(isWeekend('2026-09-21')).toBe(false);
  });

  it.each([
    ['2024-03-15', 2026, 20], // prior year hire: full
    ['2026-01-10', 2026, 20], // January hire: full
    ['2026-07-01', 2026, 10], // July hire: 6/12
    ['2026-10-20', 2026, 5], // October hire: 3/12
    ['2026-12-01', 2026, 1.5], // December: 1/12 of 20 = 1.67 → 1.5
    ['2027-01-01', 2026, 0], // not yet hired
  ])('proRate(20, hire %s, %d) = %d', (hire, year, expected) => {
    expect(proRate(20, hire, year)).toBe(expected);
  });
});

describe('LeaveBalance.available', () => {
  const bal = (o: Partial<LeaveBalance>) =>
    Object.assign(new LeaveBalance(), {
      entitled: 20,
      carriedOver: 0,
      carryOverExpiresOn: null,
      adjustment: 0,
      used: 0,
      pending: 0,
      ...o,
    });

  it('sums entitlement, carry-over and adjustment minus used and pending', () => {
    expect(
      bal({
        carriedOver: 5,
        adjustment: -1,
        used: 3,
        pending: 2.5,
      }).available(),
    ).toBe(18.5);
  });

  it('drops carry-over after its expiry date', () => {
    const b = bal({ carriedOver: 5, carryOverExpiresOn: '2026-03-31' });
    expect(b.available('2026-03-31')).toBe(25);
    expect(b.available('2026-04-01')).toBe(20);
  });
});

describe('LeavePolicyService', () => {
  let service: LeavePolicyService;
  let holidays: { find: jest.Mock };
  let balances: Record<string, jest.Mock>;
  let types: { findOne: jest.Mock };
  let employees: { findOneOrFail: jest.Mock };

  beforeEach(async () => {
    holidays = { find: jest.fn(async () => []) };
    balances = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      create: jest.fn((v) => Object.assign(new LeaveBalance(), v)),
      insert: jest.fn(),
      save: jest.fn(async (b) => b),
    };
    types = { findOne: jest.fn() };
    employees = {
      findOneOrFail: jest.fn(async () => ({
        id: 'e1',
        hireDate: '2025-06-01',
      })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LeavePolicyService,
        { provide: getRepositoryToken(LeaveType), useValue: types },
        { provide: getRepositoryToken(PublicHoliday), useValue: holidays },
        { provide: getRepositoryToken(LeaveBalance), useValue: balances },
        { provide: getRepositoryToken(LeaveBalanceAdjustment), useValue: {} },
        { provide: getRepositoryToken(Employee), useValue: employees },
      ],
    }).compile();
    service = moduleRef.get(LeavePolicyService);
  });

  describe('countWorkingDays', () => {
    it('skips weekends and public holidays', async () => {
      holidays.find.mockResolvedValue([{ date: '2026-12-25' }]);
      // Mon 21 → Mon 28 Dec 2026: 21,22,23,24,(25 holiday),(26,27 weekend),28 → 5
      expect(await service.countWorkingDays('2026-12-21', '2026-12-28')).toBe(
        5,
      );
    });

    it('half day on a single working day = 0.5; on a weekend = 0', async () => {
      expect(
        await service.countWorkingDays('2026-12-21', '2026-12-21', HalfDay.AM),
      ).toBe(0.5);
      expect(
        await service.countWorkingDays('2026-12-19', '2026-12-19', HalfDay.PM),
      ).toBe(0);
    });

    it('rejects half days on multi-day ranges and reversed ranges', async () => {
      await expect(
        service.countWorkingDays('2026-12-21', '2026-12-22', HalfDay.AM),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.countWorkingDays('2026-12-22', '2026-12-21'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('ensureBalance', () => {
    const annual = {
      id: 't-annual',
      defaultDays: 20,
      carryOverMaxDays: 5,
      carryOverExpiresOn: '03-31',
      requiresBalance: true,
    };

    it('provisions a new year row with carry-over capped by policy and dated expiry', async () => {
      types.findOne.mockResolvedValue(annual);
      balances.findOne
        .mockResolvedValueOnce(null) // current year missing
        .mockResolvedValueOnce(
          Object.assign(new LeaveBalance(), {
            entitled: 20,
            carriedOver: 0,
            carryOverExpiresOn: null,
            adjustment: 0,
            used: 12,
            pending: 0,
          }),
        ); // prev year: 8 left
      balances.findOneOrFail.mockImplementation(
        async () => balances.create.mock.results[0].value,
      );

      const row = await service.ensureBalance('e1', 't-annual', 2026);

      expect(balances.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          year: 2026,
          entitled: 20,
          carriedOver: 5,
          carryOverExpiresOn: '2026-03-31',
        }),
      );
      expect(row.available('2026-02-01')).toBe(25);
    });

    it('pro-rates the hire year', async () => {
      employees.findOneOrFail.mockResolvedValue({
        id: 'e1',
        hireDate: '2026-07-01',
      });
      types.findOne.mockResolvedValue(annual);
      balances.findOne.mockResolvedValue(null);
      balances.findOneOrFail.mockImplementation(
        async () => balances.create.mock.results[0].value,
      );

      await service.ensureBalance('e1', 't-annual', 2026);
      expect(balances.insert).toHaveBeenCalledWith(
        expect.objectContaining({ entitled: 10, carriedOver: 0 }),
      );
    });

    it('returns the existing row without inserting', async () => {
      const existing = Object.assign(new LeaveBalance(), { entitled: 20 });
      balances.findOne.mockResolvedValue(existing);
      expect(await service.ensureBalance('e1', 't-annual', 2026)).toBe(
        existing,
      );
      expect(balances.insert).not.toHaveBeenCalled();
    });
  });
});
