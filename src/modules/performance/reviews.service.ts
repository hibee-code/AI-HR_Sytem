import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { addDays, todayIso } from '../../common/utils/date';
import { EmployeesService } from '../employees/employees.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { UsersService } from '../users/users.service';
import {
  AssessmentDto,
  ListReviewsQueryDto,
  SubmitFeedbackDto,
} from './dto/performance.dto';
import { CyclePhase, ReviewCycle } from './entities/review-cycle.entity';
import {
  FeedbackStatus,
  ReviewFeedback,
} from './entities/review-feedback.entity';
import { Review, ReviewStatus } from './entities/review.entity';

/** Who may see which parts of a review. */
export interface ReviewView {
  review: Review;
  /** Peer feedback: full (with giver) for reviewer/HR; anonymised after close for the employee. */
  feedback: (Partial<ReviewFeedback> & { giverName?: string })[];
}

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(ReviewFeedback)
    private readonly feedback: Repository<ReviewFeedback>,
    @InjectRepository(ReviewCycle)
    private readonly cycles: Repository<ReviewCycle>,
    private readonly employees: EmployeesService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────

  async findById(id: string): Promise<Review> {
    const r = await this.reviews.findOne({
      where: { id },
      relations: {
        cycle: true,
        employee: { department: true },
        reviewer: true,
      },
    });
    if (!r) throw new NotFoundException('Review not found');
    return r;
  }

  async list(
    query: ListReviewsQueryDto,
    restrictToEmployeeIds?: string[],
  ): Promise<PaginatedResponse<Review>> {
    const qb = this.reviews
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.cycle', 'c')
      .innerJoinAndSelect('r.employee', 'e')
      .leftJoinAndSelect('r.reviewer', 'u')
      .orderBy('c.periodStart', 'DESC')
      .addOrderBy('e.lastName', 'ASC')
      .skip(query.skip)
      .take(query.limit);
    if (restrictToEmployeeIds) {
      if (restrictToEmployeeIds.length === 0)
        return new PaginatedResponse([], 0, query);
      qb.andWhere('r.employeeId IN (:...ids)', { ids: restrictToEmployeeIds });
    }
    if (query.cycleId)
      qb.andWhere('r.cycleId = :cycleId', { cycleId: query.cycleId });
    if (query.employeeId)
      qb.andWhere('r.employeeId = :employeeId', {
        employeeId: query.employeeId,
      });
    if (query.departmentId)
      qb.andWhere('e.departmentId = :departmentId', {
        departmentId: query.departmentId,
      });
    if (query.status)
      qb.andWhere('r.status = :status', { status: query.status });
    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResponse(data, total, query);
  }

  /** Reviews where I am the reviewer and something is expected of me. */
  pendingForReviewer(userId: string): Promise<Review[]> {
    return this.reviews.find({
      where: {
        reviewerUserId: userId,
        status: In([ReviewStatus.PENDING_SELF, ReviewStatus.PENDING_MANAGER]),
      },
      relations: { cycle: true, employee: true },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Access: HR sees all; the employee sees their own (manager assessment and
   * rating only once the cycle is closed); the reviewer / reporting chain sees
   * everything for their reports.
   */
  async view(id: string, actor: AuthUser): Promise<ReviewView> {
    const r = await this.findById(id);
    const role = await this.roleFor(r, actor);
    if (role === 'none') throw new ForbiddenException();

    const fb = await this.feedback.find({
      where: { reviewId: id },
      relations: { giver: true },
      order: { createdAt: 'ASC' },
    });
    if (role === 'employee') {
      const closed = r.cycle.phase === CyclePhase.CLOSED;
      r.calibrationNote = null; // HR-internal, never shown to the reviewee
      if (!closed) {
        r.managerAssessment = null;
        r.managerRating = null;
        r.finalRating = null;
      }
      return {
        review: r,
        feedback: closed
          ? fb
              .filter((f) => f.status === FeedbackStatus.SUBMITTED)
              .map((f) => ({
                id: f.id,
                status: f.status,
                answers: f.answers,
                submittedAt: f.submittedAt,
              }))
          : [],
      };
    }
    if (role === 'reviewer') r.calibrationNote = null; // calibration discussion is HR-internal
    return {
      review: r,
      feedback: fb.map((f) =>
        Object.assign(f, { giverName: f.giver ? f.giver.fullName : undefined }),
      ),
    };
  }

  // ── Write ─────────────────────────────────────────────────────────────

  async submitSelf(
    id: string,
    dto: AssessmentDto,
    actor: AuthUser,
  ): Promise<Review> {
    const r = await this.findById(id);
    if (r.employee.userId !== actor.id)
      throw new ForbiddenException('Not your review');
    if (
      ![CyclePhase.SELF_REVIEW, CyclePhase.MANAGER_REVIEW].includes(
        r.cycle.phase,
      )
    ) {
      throw new BadRequestException('Self-review window is closed');
    }
    if (r.managerSubmittedAt)
      throw new BadRequestException(
        'Your manager has already submitted; self-review is locked',
      );
    this.validateAssessment(dto, r.cycle);

    r.selfAssessment = toAssessment(dto);
    r.selfRating = dto.rating;
    r.selfSubmittedAt = new Date();
    if (r.status === ReviewStatus.PENDING_SELF)
      r.status = ReviewStatus.PENDING_MANAGER;
    await this.reviews.save(r);
    return this.findById(id);
  }

  async submitManager(
    id: string,
    dto: AssessmentDto,
    actor: AuthUser,
  ): Promise<Review> {
    const r = await this.findById(id);
    const role = await this.roleFor(r, actor);
    if (role !== 'reviewer' && role !== 'hr')
      throw new ForbiddenException('Only the reviewer or HR can assess');
    if (
      ![CyclePhase.MANAGER_REVIEW, CyclePhase.CALIBRATION].includes(
        r.cycle.phase,
      )
    ) {
      throw new BadRequestException('Manager-review window is not open');
    }
    this.validateAssessment(dto, r.cycle);

    r.managerAssessment = toAssessment(dto);
    r.managerRating = dto.rating;
    r.managerSubmittedAt = new Date();
    r.status =
      r.cycle.phase === CyclePhase.CALIBRATION
        ? ReviewStatus.PENDING_CALIBRATION
        : ReviewStatus.PENDING_MANAGER;
    await this.reviews.save(r);
    return this.findById(id);
  }

  async calibrate(
    id: string,
    finalRating: number,
    note: string | undefined,
  ): Promise<Review> {
    const r = await this.findById(id);
    if (r.cycle.phase !== CyclePhase.CALIBRATION)
      throw new BadRequestException('Cycle is not in calibration');
    this.assertOnScale(finalRating, r.cycle);
    r.finalRating = finalRating;
    r.calibrated = true;
    r.calibrationNote = note ?? null;
    await this.reviews.save(r);
    return this.findById(id);
  }

  async acknowledge(
    id: string,
    comment: string | undefined,
    actor: AuthUser,
  ): Promise<Review> {
    const r = await this.findById(id);
    if (r.employee.userId !== actor.id)
      throw new ForbiddenException('Not your review');
    if (r.status !== ReviewStatus.COMPLETED)
      throw new BadRequestException('Review is not ready to acknowledge');
    r.status = ReviewStatus.ACKNOWLEDGED;
    r.acknowledgedAt = new Date();
    r.employeeComment = comment ?? null;
    await this.reviews.save(r);
    return this.findById(id);
  }

  async reassignReviewer(
    id: string,
    reviewerUserId: string | null,
  ): Promise<Review> {
    const r = await this.findById(id);
    if (reviewerUserId) {
      await this.users.findById(reviewerUserId); // 404 if missing
      if (r.employee.userId === reviewerUserId)
        throw new BadRequestException('An employee cannot review themselves');
    }
    r.reviewerUserId = reviewerUserId;
    await this.reviews.save(r);
    return this.findById(id);
  }

  // ── Peer feedback ─────────────────────────────────────────────────────

  async requestFeedback(
    id: string,
    giverUserIds: string[],
    actor: AuthUser,
  ): Promise<ReviewFeedback[]> {
    const r = await this.findById(id);
    const role = await this.roleFor(r, actor);
    if (role === 'none') throw new ForbiddenException();
    if (
      r.cycle.phase === CyclePhase.CLOSED ||
      r.cycle.phase === CyclePhase.DRAFT
    ) {
      throw new BadRequestException(
        'Feedback can only be requested while the cycle is open',
      );
    }
    const created: ReviewFeedback[] = [];
    for (const giverUserId of giverUserIds) {
      if (giverUserId === r.employee.userId)
        throw new BadRequestException(
          'Cannot request feedback from the reviewee',
        );
      const giver = await this.users.findById(giverUserId);
      const exists = await this.feedback.findOne({
        where: { reviewId: id, giverUserId },
      });
      if (exists) continue;
      const f = await this.feedback.save(
        this.feedback.create({
          reviewId: id,
          giverUserId,
          requestedByUserId: actor.id,
          status: FeedbackStatus.REQUESTED,
          answers: null,
          submittedAt: null,
        }),
      );
      created.push(f);
      await this.notifications.notify({
        template: 'FEEDBACK_REQUESTED',
        to: { userId: giverUserId },
        data: {
          firstName: giver.firstName,
          aboutName: r.employee.fullName,
          cycleName: r.cycle.name,
          deadline: r.cycle.managerReviewDeadline,
        },
        dedupeKey: `feedback.requested:${f.id}`,
      });
    }
    return created;
  }

  /** Feedback requests addressed to me that are still open. */
  myFeedbackRequests(userId: string): Promise<ReviewFeedback[]> {
    return this.feedback.find({
      where: { giverUserId: userId, status: FeedbackStatus.REQUESTED },
      relations: { review: { employee: true, cycle: true } },
      order: { createdAt: 'ASC' },
    });
  }

  async submitFeedback(
    feedbackId: string,
    dto: SubmitFeedbackDto,
    actor: AuthUser,
    decline = false,
  ): Promise<ReviewFeedback> {
    const f = await this.feedback.findOne({
      where: { id: feedbackId },
      relations: { review: { cycle: true } },
    });
    if (!f) throw new NotFoundException('Feedback request not found');
    if (f.giverUserId !== actor.id)
      throw new ForbiddenException('Not your feedback request');
    if (f.status !== FeedbackStatus.REQUESTED)
      throw new BadRequestException('Already answered');
    if (f.review.cycle.phase === CyclePhase.CLOSED)
      throw new BadRequestException('Cycle is closed');
    if (decline) {
      f.status = FeedbackStatus.DECLINED;
    } else {
      if (dto.rating !== undefined)
        this.assertOnScale(dto.rating, f.review.cycle);
      f.status = FeedbackStatus.SUBMITTED;
      f.answers = {
        strengths: dto.strengths,
        improvements: dto.improvements,
        rating: dto.rating,
      };
    }
    f.submittedAt = new Date();
    return this.feedback.save(f);
  }

  // ── Reminders (daily job) ─────────────────────────────────────────────

  /** Nudges employees/reviewers whose deadline is within 2 days or past. Returns notifications queued. */
  async sendReminders(today: string = todayIso()): Promise<number> {
    const soon = addDays(today, 2);
    let sent = 0;

    const selfDue = await this.cycles.find({
      where: {
        phase: CyclePhase.SELF_REVIEW,
        selfReviewDeadline: LessThanOrEqual(soon),
      },
    });
    for (const c of selfDue) {
      const pending = await this.reviews.find({
        where: { cycleId: c.id, status: ReviewStatus.PENDING_SELF },
        relations: { employee: true },
      });
      for (const r of pending) {
        if (!r.employee.userId) continue;
        await this.notifications.notify({
          template: 'REVIEW_ACTION_REQUIRED',
          to: { userId: r.employee.userId },
          data: {
            firstName: r.employee.firstName,
            action: 'complete your self-review',
            cycleName: c.name,
            deadline: c.selfReviewDeadline,
          },
          dedupeKey: `review.remind.self:${r.id}:${today}`,
        });
        sent++;
      }
    }

    const mgrDue = await this.cycles.find({
      where: {
        phase: CyclePhase.MANAGER_REVIEW,
        managerReviewDeadline: LessThanOrEqual(soon),
      },
    });
    for (const c of mgrDue) {
      const pending = await this.reviews.find({
        where: { cycleId: c.id, status: ReviewStatus.PENDING_MANAGER },
        relations: { employee: true, reviewer: true },
      });
      const byReviewer = new Map<
        string,
        { firstName: string; count: number }
      >();
      for (const r of pending) {
        if (!r.reviewerUserId || r.managerSubmittedAt) continue;
        const cur = byReviewer.get(r.reviewerUserId) ?? {
          firstName: r.reviewer?.firstName ?? 'there',
          count: 0,
        };
        cur.count++;
        byReviewer.set(r.reviewerUserId, cur);
      }
      for (const [userId, v] of byReviewer) {
        await this.notifications.notify({
          template: 'REVIEW_ACTION_REQUIRED',
          to: { userId },
          data: {
            firstName: v.firstName,
            action: `write ${v.count} team review${v.count === 1 ? '' : 's'}`,
            cycleName: c.name,
            deadline: c.managerReviewDeadline,
          },
          dedupeKey: `review.remind.mgr:${c.id}:${userId}:${today}`,
        });
        sent++;
      }
    }
    return sent;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /** 'hr' | 'reviewer' (designated or anyone above in the chain) | 'employee' | 'none' */
  async roleFor(
    r: Review,
    actor: AuthUser,
  ): Promise<'hr' | 'reviewer' | 'employee' | 'none'> {
    if (actor.permissions.includes(PERMISSIONS.REVIEW_MANAGE_CYCLES))
      return 'hr';
    if (r.employee.userId === actor.id) return 'employee';
    if (r.reviewerUserId === actor.id) return 'reviewer';
    if (actor.permissions.includes(PERMISSIONS.REVIEW_WRITE_TEAM)) {
      const me = await this.employees.findByUserId(actor.id);
      if (me && (await this.employees.isInReportingChain(me.id, r.employeeId)))
        return 'reviewer';
    }
    return 'none';
  }

  private validateAssessment(dto: AssessmentDto, cycle: ReviewCycle): void {
    this.assertOnScale(dto.rating, cycle);
    const missing = cycle.competencies.filter(
      (c) => typeof dto.competencies[c] !== 'number',
    );
    if (missing.length)
      throw new BadRequestException(
        `Score every competency: missing ${missing.join(', ')}`,
      );
    for (const [k, v] of Object.entries(dto.competencies)) {
      if (!cycle.competencies.includes(k))
        throw new BadRequestException(`Unknown competency ${k}`);
      this.assertOnScale(v, cycle);
    }
  }

  private assertOnScale(value: number, cycle: ReviewCycle): void {
    if (!cycle.ratingScale.some((l) => l.value === value)) {
      throw new BadRequestException(
        `Rating must be one of ${cycle.ratingScale.map((l) => l.value).join(', ')}`,
      );
    }
  }
}

function toAssessment(dto: AssessmentDto) {
  return {
    summary: dto.summary,
    achievements: dto.achievements,
    challenges: dto.challenges,
    competencies: dto.competencies,
  };
}
