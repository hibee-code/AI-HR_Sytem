import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { EmployeesService } from '../employees/employees.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import {
  CyclePhase,
  DEFAULT_RATING_SCALE,
  ReviewCycle,
} from './entities/review-cycle.entity';
import {
  FeedbackStatus,
  ReviewFeedback,
} from './entities/review-feedback.entity';
import { Review, ReviewStatus } from './entities/review.entity';
import { ReviewsService } from './reviews.service';

const actor = (o: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u-emp',
  email: 'e@x',
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [PERMISSIONS.REVIEW_READ_SELF],
  passwordChangedAt: null,
  ...o,
});
const MANAGER = actor({
  id: 'u-mgr',
  permissions: [PERMISSIONS.REVIEW_WRITE_TEAM],
});
const HR = actor({
  id: 'u-hr',
  permissions: [PERMISSIONS.REVIEW_MANAGE_CYCLES],
});

const cycle = (phase: CyclePhase, competencies = ['Ownership']): ReviewCycle =>
  Object.assign(new ReviewCycle(), {
    id: 'c1',
    name: 'H2',
    phase,
    ratingScale: DEFAULT_RATING_SCALE,
    competencies,
    managerReviewDeadline: '2027-01-31',
  });

const review = (
  o: Partial<Review> = {},
  phase = CyclePhase.SELF_REVIEW,
): Review =>
  Object.assign(new Review(), {
    id: 'r1',
    cycleId: 'c1',
    employeeId: 'e1',
    reviewerUserId: 'u-mgr',
    status: ReviewStatus.PENDING_SELF,
    selfAssessment: null,
    selfRating: null,
    selfSubmittedAt: null,
    managerAssessment: null,
    managerRating: null,
    managerSubmittedAt: null,
    finalRating: null,
    calibrated: false,
    calibrationNote: null,
    cycle: cycle(phase),
    employee: {
      id: 'e1',
      userId: 'u-emp',
      firstName: 'Jane',
      fullName: 'Jane Doe',
    },
    ...o,
  });

const assessment = {
  summary: 'Good half',
  competencies: { Ownership: 4 },
  rating: 4,
};

describe('ReviewsService', () => {
  let service: ReviewsService;
  let reviews: Record<string, jest.Mock>;
  let feedback: Record<string, jest.Mock>;
  let employees: Record<string, jest.Mock>;
  let notifications: { notify: jest.Mock };

  beforeEach(async () => {
    reviews = {
      findOne: jest.fn(),
      save: jest.fn(async (r) => r),
      find: jest.fn(async () => []),
    };
    feedback = {
      find: jest.fn(async () => []),
      findOne: jest.fn(),
      create: jest.fn((v) => Object.assign(new ReviewFeedback(), v)),
      save: jest.fn(async (f) => Object.assign(f, { id: 'f1' })),
    };
    employees = {
      findByUserId: jest.fn(async () => null),
      isInReportingChain: jest.fn(async () => false),
    };
    notifications = { notify: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: reviews },
        { provide: getRepositoryToken(ReviewFeedback), useValue: feedback },
        {
          provide: getRepositoryToken(ReviewCycle),
          useValue: { find: jest.fn(async () => []) },
        },
        { provide: EmployeesService, useValue: employees },
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn(async (id: string) => ({ id, firstName: 'Bob' })),
          },
        },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(ReviewsService);
  });

  describe('self-review', () => {
    it('employee submits during SELF_REVIEW; status moves to PENDING_MANAGER', async () => {
      reviews.findOne.mockResolvedValue(review());
      await service.submitSelf('r1', assessment, actor());
      expect(reviews.save).toHaveBeenCalledWith(
        expect.objectContaining({
          selfRating: 4,
          status: ReviewStatus.PENDING_MANAGER,
          selfAssessment: expect.objectContaining({ summary: 'Good half' }),
        }),
      );
    });

    it('rejects others, closed windows, off-scale ratings and missing competencies', async () => {
      reviews.findOne.mockResolvedValue(review());
      await expect(
        service.submitSelf('r1', assessment, actor({ id: 'u-other' })),
      ).rejects.toThrow(ForbiddenException);
      reviews.findOne.mockResolvedValue(review({}, CyclePhase.CALIBRATION));
      await expect(
        service.submitSelf('r1', assessment, actor()),
      ).rejects.toThrow(/window is closed/);
      reviews.findOne.mockResolvedValue(review());
      await expect(
        service.submitSelf('r1', { ...assessment, rating: 7 }, actor()),
      ).rejects.toThrow(/must be one of/);
      await expect(
        service.submitSelf('r1', { ...assessment, competencies: {} }, actor()),
      ).rejects.toThrow(/missing Ownership/);
    });

    it('is locked once the manager has submitted', async () => {
      reviews.findOne.mockResolvedValue(
        review({ managerSubmittedAt: new Date() }, CyclePhase.MANAGER_REVIEW),
      );
      await expect(
        service.submitSelf('r1', assessment, actor()),
      ).rejects.toThrow(/locked/);
    });
  });

  describe('manager review', () => {
    it('designated reviewer submits in MANAGER_REVIEW; a manager higher in the chain may too; HR may', async () => {
      reviews.findOne.mockResolvedValue(review({}, CyclePhase.MANAGER_REVIEW));
      await expect(
        service.submitManager('r1', assessment, MANAGER),
      ).resolves.toBeDefined();

      employees.findByUserId.mockResolvedValue({ id: 'e-dir' });
      employees.isInReportingChain.mockResolvedValue(true);
      await expect(
        service.submitManager(
          'r1',
          assessment,
          actor({ id: 'u-dir', permissions: [PERMISSIONS.REVIEW_WRITE_TEAM] }),
        ),
      ).resolves.toBeDefined();
      await expect(
        service.submitManager('r1', assessment, HR),
      ).resolves.toBeDefined();
    });

    it('the employee and strangers cannot; not before MANAGER_REVIEW', async () => {
      reviews.findOne.mockResolvedValue(review({}, CyclePhase.MANAGER_REVIEW));
      await expect(
        service.submitManager('r1', assessment, actor()),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.submitManager(
          'r1',
          assessment,
          actor({ id: 'u-x', permissions: [PERMISSIONS.REVIEW_WRITE_TEAM] }),
        ),
      ).rejects.toThrow(ForbiddenException);
      reviews.findOne.mockResolvedValue(review({}, CyclePhase.SELF_REVIEW));
      await expect(
        service.submitManager('r1', assessment, MANAGER),
      ).rejects.toThrow(/not open/);
    });
  });

  describe('visibility', () => {
    it('employee cannot see the manager rating until the cycle is closed; then sees anonymised feedback', async () => {
      const r = review(
        {
          managerRating: 4,
          managerAssessment: { summary: 's', competencies: {} },
          finalRating: 4,
          calibrationNote: 'secret',
        },
        CyclePhase.CALIBRATION,
      );
      reviews.findOne.mockResolvedValue(r);
      feedback.find.mockResolvedValue([
        Object.assign(new ReviewFeedback(), {
          id: 'f1',
          status: FeedbackStatus.SUBMITTED,
          answers: { strengths: 'x', improvements: 'y' },
          giver: { fullName: 'Peer One' },
        }),
      ]);

      const hidden = await service.view('r1', actor());
      expect(hidden.review.managerRating).toBeNull();
      expect(hidden.review.finalRating).toBeNull();
      expect(hidden.feedback).toEqual([]);

      reviews.findOne.mockResolvedValue(
        review(
          { managerRating: 4, finalRating: 4, calibrationNote: 'secret' },
          CyclePhase.CLOSED,
        ),
      );
      const shown = await service.view('r1', actor());
      expect(shown.review.finalRating).toBe(4);
      expect(shown.review.calibrationNote).toBeNull();
      expect(shown.feedback[0]).toEqual({
        id: 'f1',
        status: 'SUBMITTED',
        answers: { strengths: 'x', improvements: 'y' },
        submittedAt: undefined,
      });
      expect(JSON.stringify(shown.feedback)).not.toContain('Peer One');
    });

    it('reviewer sees feedback with giver names but not the calibration note; HR sees all', async () => {
      reviews.findOne.mockResolvedValue(
        review({ calibrationNote: 'secret' }, CyclePhase.CALIBRATION),
      );
      feedback.find.mockResolvedValue([
        Object.assign(new ReviewFeedback(), {
          id: 'f1',
          status: FeedbackStatus.SUBMITTED,
          giver: { fullName: 'Peer One' },
        }),
      ]);
      const mgr = await service.view('r1', MANAGER);
      expect(mgr.feedback[0].giverName).toBe('Peer One');
      expect(mgr.review.calibrationNote).toBeNull();
      reviews.findOne.mockResolvedValue(
        review({ calibrationNote: 'secret' }, CyclePhase.CALIBRATION),
      );
      expect((await service.view('r1', HR)).review.calibrationNote).toBe(
        'secret',
      );
    });
  });

  describe('calibration & acknowledgement', () => {
    it('HR calibrates only in CALIBRATION, on-scale', async () => {
      reviews.findOne.mockResolvedValue(review({}, CyclePhase.MANAGER_REVIEW));
      await expect(service.calibrate('r1', 3, 'note')).rejects.toThrow(
        /not in calibration/,
      );
      reviews.findOne.mockResolvedValue(review({}, CyclePhase.CALIBRATION));
      await expect(service.calibrate('r1', 9, 'note')).rejects.toThrow(
        BadRequestException,
      );
      await service.calibrate('r1', 3, 'levelled');
      expect(reviews.save).toHaveBeenCalledWith(
        expect.objectContaining({
          finalRating: 3,
          calibrated: true,
          calibrationNote: 'levelled',
        }),
      );
    });

    it('employee acknowledges a COMPLETED review', async () => {
      reviews.findOne.mockResolvedValue(
        review(
          { status: ReviewStatus.COMPLETED, finalRating: 4 },
          CyclePhase.CLOSED,
        ),
      );
      await service.acknowledge('r1', 'thanks', actor());
      expect(reviews.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ReviewStatus.ACKNOWLEDGED,
          employeeComment: 'thanks',
        }),
      );
      reviews.findOne.mockResolvedValue(
        review({ status: ReviewStatus.PENDING_MANAGER }),
      );
      await expect(
        service.acknowledge('r1', undefined, actor()),
      ).rejects.toThrow(/not ready/);
    });
  });

  describe('peer feedback', () => {
    it('requests notify givers, skip duplicates, refuse the reviewee', async () => {
      reviews.findOne.mockResolvedValue(review({}, CyclePhase.SELF_REVIEW));
      feedback.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing' });
      const created = await service.requestFeedback(
        'r1',
        ['u-peer1', 'u-peer2'],
        actor(),
      );
      expect(created).toHaveLength(1);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'FEEDBACK_REQUESTED',
          to: { userId: 'u-peer1' },
        }),
      );
      await expect(
        service.requestFeedback('r1', ['u-emp'], MANAGER),
      ).rejects.toThrow(/reviewee/);
    });

    it('only the giver answers, once', async () => {
      const f = Object.assign(new ReviewFeedback(), {
        id: 'f1',
        giverUserId: 'u-peer',
        status: FeedbackStatus.REQUESTED,
        review: { cycle: cycle(CyclePhase.MANAGER_REVIEW) },
      });
      feedback.findOne.mockResolvedValue(f);
      await expect(
        service.submitFeedback(
          'f1',
          { strengths: 'a', improvements: 'b' },
          actor(),
        ),
      ).rejects.toThrow(ForbiddenException);
      await service.submitFeedback(
        'f1',
        { strengths: 'a', improvements: 'b', rating: 4 },
        actor({ id: 'u-peer' }),
      );
      expect(f.status).toBe(FeedbackStatus.SUBMITTED);
      await expect(
        service.submitFeedback(
          'f1',
          { strengths: 'a', improvements: 'b' },
          actor({ id: 'u-peer' }),
        ),
      ).rejects.toThrow(/Already answered/);
    });
  });
});
