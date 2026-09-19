import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  Employee,
  EmployeeStatus,
} from '../employees/entities/employee.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CyclesService } from './cycles.service';
import {
  CyclePhase,
  DEFAULT_RATING_SCALE,
  ReviewCycle,
} from './entities/review-cycle.entity';
import { Review, ReviewStatus } from './entities/review.entity';

describe('CyclesService', () => {
  let service: CyclesService;
  let cycles: Record<string, jest.Mock>;
  let reviews: Record<string, jest.Mock>;
  let employees: Record<string, jest.Mock>;
  let notifications: { notify: jest.Mock };

  const cycle = (o: Partial<ReviewCycle> = {}) =>
    Object.assign(new ReviewCycle(), {
      id: 'c1',
      name: 'H2',
      phase: CyclePhase.DRAFT,
      departmentId: null,
      ratingScale: DEFAULT_RATING_SCALE,
      competencies: [],
      periodStart: '2026-07-01',
      periodEnd: '2026-12-31',
      selfReviewDeadline: '2027-01-15',
      managerReviewDeadline: '2027-01-31',
      ...o,
    });

  beforeEach(async () => {
    cycles = {
      findOne: jest.fn(),
      save: jest.fn(async (c) => c),
      create: jest.fn((v) => Object.assign(new ReviewCycle(), v)),
      findAndCount: jest.fn(),
      remove: jest.fn(),
    };
    const updateQb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };
    reviews = {
      save: jest.fn(async (r) => r),
      create: jest.fn((v) => Object.assign(new Review(), v)),
      update: jest.fn(),
      find: jest.fn(async () => []),
      createQueryBuilder: jest.fn(() => updateQb),
    };
    employees = {
      find: jest.fn(async () => []),
      query: jest.fn(async () => []),
    };
    notifications = { notify: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CyclesService,
        { provide: getRepositoryToken(ReviewCycle), useValue: cycles },
        { provide: getRepositoryToken(Review), useValue: reviews },
        { provide: getRepositoryToken(Employee), useValue: employees },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(CyclesService);
  });

  it('create validates dates and sorts the rating scale', async () => {
    await expect(
      service.create(
        {
          name: 'x',
          periodStart: '2026-07-01',
          periodEnd: '2026-06-01',
          selfReviewDeadline: '2027-01-01',
          managerReviewDeadline: '2027-01-02',
        },
        'hr',
      ),
    ).rejects.toThrow(/periodEnd/);
    const c = await service.create(
      {
        name: 'x',
        periodStart: '2026-07-01',
        periodEnd: '2026-12-31',
        selfReviewDeadline: '2027-01-01',
        managerReviewDeadline: '2027-01-02',
        ratingScale: [
          { value: 3, label: 'c' },
          { value: 1, label: 'a' },
        ],
      },
      'hr',
    );
    expect(c.ratingScale.map((r) => r.value)).toEqual([1, 3]);
    expect(c.phase).toBe(CyclePhase.DRAFT);
  });

  it('launch creates one review per non-terminated employee with the manager as reviewer, then notifies', async () => {
    cycles.findOne.mockResolvedValue(cycle());
    employees.find.mockResolvedValue([
      {
        id: 'e1',
        userId: 'u1',
        firstName: 'A',
        status: EmployeeStatus.ACTIVE,
        manager: { userId: 'u-mgr' },
      },
      {
        id: 'e2',
        userId: null,
        firstName: 'B',
        status: EmployeeStatus.ONBOARDING,
        manager: null,
      },
    ]);

    const { created } = await service.launch('c1');

    expect(created).toBe(2);
    const saved = reviews.save.mock.calls[0][0] as Review[];
    expect(
      saved.map((r) => [r.employeeId, r.reviewerUserId, r.status]),
    ).toEqual([
      ['e1', 'u-mgr', ReviewStatus.PENDING_SELF],
      ['e2', null, ReviewStatus.PENDING_SELF],
    ]);
    expect(cycles.save).toHaveBeenCalledWith(
      expect.objectContaining({ phase: CyclePhase.SELF_REVIEW }),
    );
    expect(notifications.notify).toHaveBeenCalledTimes(1); // e2 has no login
  });

  it('launch refuses a launched cycle or an empty scope', async () => {
    cycles.findOne.mockResolvedValue(cycle({ phase: CyclePhase.SELF_REVIEW }));
    await expect(service.launch('c1')).rejects.toThrow(/already been launched/);
    cycles.findOne.mockResolvedValue(cycle());
    await expect(service.launch('c1')).rejects.toThrow(/No employees/);
  });

  it('advance walks phases forward; entering CLOSED defaults final ratings and notifies', async () => {
    cycles.findOne.mockResolvedValue(cycle({ phase: CyclePhase.SELF_REVIEW }));
    await service.advance('c1');
    expect(reviews.update).toHaveBeenCalledWith(
      { cycleId: 'c1', status: ReviewStatus.PENDING_SELF },
      { status: ReviewStatus.PENDING_MANAGER },
    );

    cycles.findOne.mockResolvedValue(cycle({ phase: CyclePhase.CALIBRATION }));
    reviews.find.mockResolvedValue([
      Object.assign(new Review(), {
        id: 'r1',
        finalRating: 4,
        employee: { userId: 'u1', firstName: 'A' },
      }),
    ]);
    const closed = await service.advance('c1');
    expect(closed.phase).toBe(CyclePhase.CLOSED);
    expect(reviews.createQueryBuilder).toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'REVIEW_COMPLETED',
        data: expect.objectContaining({ ratingLabel: 'Exceeds expectations' }),
      }),
    );

    cycles.findOne.mockResolvedValue(cycle({ phase: CyclePhase.CLOSED }));
    await expect(service.advance('c1')).rejects.toThrow(/already closed/);
    cycles.findOne.mockResolvedValue(cycle());
    await expect(service.advance('c1')).rejects.toThrow(/Launch/);
  });

  it('structure is frozen after launch', async () => {
    cycles.findOne.mockResolvedValue(cycle({ phase: CyclePhase.SELF_REVIEW }));
    await expect(service.update('c1', { competencies: ['X'] })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.update('c1', { name: 'Renamed' }),
    ).resolves.toBeDefined();
  });
});
