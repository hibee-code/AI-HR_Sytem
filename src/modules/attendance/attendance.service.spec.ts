import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Employee } from '../employees/entities/employee.entity';
import { LeaveRequest } from '../leave/entities/leave-request.entity';
import { AttendanceService, minutesBetween } from './attendance.service';
import {
  AttendanceRecord,
  AttendanceSource,
} from './entities/attendance-record.entity';

describe('AttendanceService', () => {
  let service: AttendanceService;
  let records: Record<string, jest.Mock>;

  beforeEach(async () => {
    records = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      create: jest.fn((v) => Object.assign(new AttendanceRecord(), v)),
      save: jest.fn(async (r) => r),
      remove: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: getRepositoryToken(AttendanceRecord), useValue: records },
        {
          provide: getRepositoryToken(Employee),
          useValue: { exists: jest.fn(async () => true) },
        },
        { provide: getRepositoryToken(LeaveRequest), useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(AttendanceService);
  });

  it('clock-in opens a session; a second clock-in is refused', async () => {
    const now = new Date('2026-10-05T08:00:00Z');
    const r = await service.clockIn('e1', undefined, now);
    expect(r).toMatchObject({
      date: '2026-10-05',
      clockOut: null,
      source: AttendanceSource.CLOCK,
    });

    records.findOne.mockResolvedValue(r);
    await expect(service.clockIn('e1')).rejects.toThrow(ConflictException);
  });

  it('clock-out closes the open session and computes minutes', async () => {
    const open = Object.assign(new AttendanceRecord(), {
      clockIn: new Date('2026-10-05T08:00:00Z'),
      clockOut: null,
      note: null,
    });
    records.findOne.mockResolvedValue(open);
    const r = await service.clockOut(
      'e1',
      'done',
      new Date('2026-10-05T16:30:00Z'),
    );
    expect(r.workedMinutes).toBe(510);
    expect(r.note).toBe('done');
  });

  it('clock-out without an open session is a 400', async () => {
    await expect(service.clockOut('e1')).rejects.toThrow(BadRequestException);
  });

  it('manual entries validate the range', async () => {
    await expect(
      service.createManual(
        {
          employeeId: 'e1',
          clockIn: '2026-10-05T09:00:00Z',
          clockOut: '2026-10-05T08:00:00Z',
        },
        'hr',
      ),
    ).rejects.toThrow(/after clockIn/);
    await expect(
      service.createManual(
        {
          employeeId: 'e1',
          clockIn: '2026-10-05T00:00:00Z',
          clockOut: '2026-10-06T01:00:00Z',
        },
        'hr',
      ),
    ).rejects.toThrow(/24 hours/);
    const ok = await service.createManual(
      {
        employeeId: 'e1',
        clockIn: '2026-10-05T09:00:00Z',
        clockOut: '2026-10-05T17:00:00Z',
      },
      'hr',
    );
    expect(ok).toMatchObject({
      workedMinutes: 480,
      source: AttendanceSource.MANUAL,
      createdByUserId: 'hr',
    });
  });

  it('daily summary aggregates sessions per date and flags open ones', async () => {
    records.find.mockResolvedValue([
      Object.assign(new AttendanceRecord(), {
        date: '2026-10-05',
        workedMinutes: 240,
        clockOut: new Date(),
      }),
      Object.assign(new AttendanceRecord(), {
        date: '2026-10-05',
        workedMinutes: 200,
        clockOut: new Date(),
      }),
      Object.assign(new AttendanceRecord(), {
        date: '2026-10-06',
        workedMinutes: null,
        clockOut: null,
      }),
    ]);
    const { daily } = await service.recordsFor(
      'e1',
      '2026-10-01',
      '2026-10-31',
    );
    expect(daily).toEqual([
      {
        date: '2026-10-05',
        workedMinutes: 440,
        sessions: 2,
        hasOpenSession: false,
      },
      {
        date: '2026-10-06',
        workedMinutes: 0,
        sessions: 1,
        hasOpenSession: true,
      },
    ]);
  });

  it('auto-close caps forgotten sessions at 16h and flags them', async () => {
    const stale = Object.assign(new AttendanceRecord(), {
      clockIn: new Date('2026-10-05T08:00:00Z'),
      clockOut: null,
      note: null,
    });
    records.find.mockResolvedValue([stale]);
    const n = await service.autoCloseStaleSessions(
      new Date('2026-10-06T09:00:00Z'),
    );
    expect(n).toBe(1);
    expect((stale.clockOut as Date | null)?.toISOString()).toBe(
      '2026-10-06T00:00:00.000Z',
    );
    expect(stale).toMatchObject({ workedMinutes: 960, autoClosed: true });
    expect(stale.note).toContain('auto-closed');
  });

  it('minutesBetween never goes negative', () => {
    expect(minutesBetween(new Date(10_000), new Date(0))).toBe(0);
  });
});
