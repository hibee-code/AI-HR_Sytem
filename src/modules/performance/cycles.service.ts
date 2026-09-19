import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import {
  Employee,
  EmployeeStatus,
} from '../employees/entities/employee.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateCycleDto,
  ListCyclesQueryDto,
  UpdateCycleDto,
} from './dto/performance.dto';
import {
  CyclePhase,
  DEFAULT_RATING_SCALE,
  PHASE_ORDER,
  ReviewCycle,
} from './entities/review-cycle.entity';
import { Review, ReviewStatus } from './entities/review.entity';

export interface CycleReportRow {
  departmentId: string;
  department: string;
  reviews: number;
  completed: number;
  acknowledged: number;
  averageFinalRating: number | null;
  /** rating value → count */
  distribution: Record<string, number>;
}

@Injectable()
export class CyclesService {
  constructor(
    @InjectRepository(ReviewCycle)
    private readonly cycles: Repository<ReviewCycle>,
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    private readonly notifications: NotificationsService,
  ) {}

  async list(
    query: ListCyclesQueryDto,
  ): Promise<PaginatedResponse<ReviewCycle>> {
    const [data, total] = await this.cycles.findAndCount({
      where: query.phase ? { phase: query.phase } : {},
      relations: { department: true },
      order: { periodStart: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return new PaginatedResponse(data, total, query);
  }

  async findById(id: string): Promise<ReviewCycle> {
    const c = await this.cycles.findOne({
      where: { id },
      relations: { department: true },
    });
    if (!c) throw new NotFoundException('Review cycle not found');
    return c;
  }

  async create(dto: CreateCycleDto, actorUserId: string): Promise<ReviewCycle> {
    this.validateDates(dto);
    return this.cycles.save(
      this.cycles.create({
        name: dto.name,
        description: dto.description ?? null,
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
        phase: CyclePhase.DRAFT,
        selfReviewDeadline: dto.selfReviewDeadline,
        managerReviewDeadline: dto.managerReviewDeadline,
        departmentId: dto.departmentId ?? null,
        ratingScale: normaliseScale(dto.ratingScale ?? DEFAULT_RATING_SCALE),
        competencies: dto.competencies ?? [],
        launchedAt: null,
        closedAt: null,
        createdByUserId: actorUserId,
      }),
    );
  }

  /** Structure (scope, scale, competencies) is frozen once launched; dates and text stay editable. */
  async update(id: string, dto: UpdateCycleDto): Promise<ReviewCycle> {
    const c = await this.findById(id);
    const launched = c.phase !== CyclePhase.DRAFT;
    if (
      launched &&
      (dto.departmentId !== undefined || dto.ratingScale || dto.competencies)
    ) {
      throw new BadRequestException(
        'Scope, rating scale and competencies cannot change after launch',
      );
    }
    if (dto.ratingScale) c.ratingScale = normaliseScale(dto.ratingScale);
    if (dto.competencies) c.competencies = dto.competencies;
    if (dto.departmentId !== undefined) c.departmentId = dto.departmentId;
    for (const k of [
      'name',
      'description',
      'periodStart',
      'periodEnd',
      'selfReviewDeadline',
      'managerReviewDeadline',
    ] as const) {
      if (dto[k] !== undefined)
        (c as unknown as Record<string, unknown>)[k] = dto[k];
    }
    this.validateDates(c);
    await this.cycles.save(c);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    const c = await this.findById(id);
    if (c.phase !== CyclePhase.DRAFT)
      throw new BadRequestException('Only draft cycles can be deleted');
    await this.cycles.remove(c);
  }

  /**
   * DRAFT → SELF_REVIEW: creates a review for every non-terminated employee in
   * scope (department subtree or whole company) with their manager as reviewer.
   */
  async launch(id: string): Promise<{ cycle: ReviewCycle; created: number }> {
    const c = await this.findById(id);
    if (c.phase !== CyclePhase.DRAFT)
      throw new BadRequestException('Cycle has already been launched');

    const scope = c.departmentId
      ? await this.departmentSubtree(c.departmentId)
      : null;
    const emps = await this.employees.find({
      where: {
        status: Not(EmployeeStatus.TERMINATED),
        ...(scope ? { departmentId: In(scope) } : {}),
      },
      relations: { manager: true },
    });
    if (emps.length === 0)
      throw new BadRequestException('No employees in scope');

    await this.reviews.save(
      emps.map((e) =>
        this.reviews.create({
          cycleId: c.id,
          employeeId: e.id,
          reviewerUserId: e.manager?.userId ?? null,
          status: ReviewStatus.PENDING_SELF,
        }),
      ),
    );
    c.phase = CyclePhase.SELF_REVIEW;
    c.launchedAt = new Date();
    await this.cycles.save(c);

    for (const e of emps) {
      if (!e.userId) continue;
      await this.notifications.notify({
        template: 'REVIEW_CYCLE_LAUNCHED',
        to: { userId: e.userId },
        data: {
          firstName: e.firstName,
          cycleName: c.name,
          selfReviewDeadline: c.selfReviewDeadline,
        },
        dedupeKey: `review.launched:${c.id}:${e.id}`,
      });
    }
    return { cycle: await this.findById(id), created: emps.length };
  }

  /** Moves to the next phase. Entering CLOSED finalises ratings and asks employees to acknowledge. */
  async advance(id: string): Promise<ReviewCycle> {
    const c = await this.findById(id);
    const idx = PHASE_ORDER.indexOf(c.phase);
    if (c.phase === CyclePhase.DRAFT)
      throw new BadRequestException('Launch the cycle first');
    if (c.phase === CyclePhase.CLOSED)
      throw new BadRequestException('Cycle is already closed');
    const next = PHASE_ORDER[idx + 1];

    if (next === CyclePhase.MANAGER_REVIEW) {
      // Late self-reviews are still allowed; managers can now write.
      await this.reviews.update(
        { cycleId: id, status: ReviewStatus.PENDING_SELF },
        { status: ReviewStatus.PENDING_MANAGER },
      );
    }
    if (next === CyclePhase.CALIBRATION) {
      await this.reviews.update(
        { cycleId: id, status: ReviewStatus.PENDING_MANAGER },
        { status: ReviewStatus.PENDING_CALIBRATION },
      );
    }
    if (next === CyclePhase.CLOSED) {
      await this.reviews
        .createQueryBuilder()
        .update(Review)
        .set({
          finalRating: () => 'COALESCE(final_rating, manager_rating)',
          status: ReviewStatus.COMPLETED,
        })
        .where('cycle_id = :id AND status != :ack', {
          id,
          ack: ReviewStatus.ACKNOWLEDGED,
        })
        .execute();
      c.closedAt = new Date();
    }
    c.phase = next;
    await this.cycles.save(c);

    if (next === CyclePhase.CLOSED) await this.notifyClosed(c);
    return this.findById(id);
  }

  async report(id: string): Promise<CycleReportRow[]> {
    await this.findById(id);
    const rows: {
      departmentId: string;
      department: string;
      status: ReviewStatus;
      finalRating: number | null;
    }[] = await this.reviews
      .createQueryBuilder('r')
      .innerJoin('r.employee', 'e')
      .innerJoin('e.department', 'd')
      .select('d.id', 'departmentId')
      .addSelect('d.name', 'department')
      .addSelect('r.status', 'status')
      .addSelect('r.final_rating', 'finalRating')
      .where('r.cycle_id = :id', { id })
      .getRawMany();

    const byDept = new Map<
      string,
      CycleReportRow & { sum: number; rated: number }
    >();
    for (const r of rows) {
      const row = byDept.get(r.departmentId) ?? {
        departmentId: r.departmentId,
        department: r.department,
        reviews: 0,
        completed: 0,
        acknowledged: 0,
        averageFinalRating: null,
        distribution: {},
        sum: 0,
        rated: 0,
      };
      row.reviews++;
      if (
        r.status === ReviewStatus.COMPLETED ||
        r.status === ReviewStatus.ACKNOWLEDGED
      )
        row.completed++;
      if (r.status === ReviewStatus.ACKNOWLEDGED) row.acknowledged++;
      if (r.finalRating !== null) {
        const v = Number(r.finalRating);
        row.sum += v;
        row.rated++;
        row.distribution[v] = (row.distribution[v] ?? 0) + 1;
      }
      byDept.set(r.departmentId, row);
    }
    return [...byDept.values()]
      .map(({ sum, rated, ...row }) => ({
        ...row,
        averageFinalRating: rated
          ? Math.round((sum / rated) * 100) / 100
          : null,
      }))
      .sort((a, b) => a.department.localeCompare(b.department));
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async notifyClosed(c: ReviewCycle): Promise<void> {
    const reviews = await this.reviews.find({
      where: { cycleId: c.id },
      relations: { employee: true },
    });
    for (const r of reviews) {
      if (!r.employee.userId || r.finalRating === null) continue;
      const label =
        c.ratingScale.find((l) => l.value === r.finalRating)?.label ??
        String(r.finalRating);
      await this.notifications.notify({
        template: 'REVIEW_COMPLETED',
        to: { userId: r.employee.userId },
        data: {
          firstName: r.employee.firstName,
          cycleName: c.name,
          ratingLabel: label,
        },
        dedupeKey: `review.completed:${r.id}`,
      });
    }
  }

  private async departmentSubtree(rootId: string): Promise<string[]> {
    const rows: { id: string }[] = await this.employees.query(
      `WITH RECURSIVE sub AS (
         SELECT id FROM departments WHERE id = $1
         UNION ALL
         SELECT d.id FROM departments d JOIN sub ON d.parent_id = sub.id
       ) SELECT id FROM sub`,
      [rootId],
    );
    return rows.map((r) => r.id);
  }

  private validateDates(
    c: Pick<
      ReviewCycle,
      | 'periodStart'
      | 'periodEnd'
      | 'selfReviewDeadline'
      | 'managerReviewDeadline'
    >,
  ): void {
    if (c.periodEnd < c.periodStart)
      throw new BadRequestException(
        'periodEnd must be on or after periodStart',
      );
    if (c.managerReviewDeadline < c.selfReviewDeadline) {
      throw new BadRequestException(
        'managerReviewDeadline must be on or after selfReviewDeadline',
      );
    }
  }
}

function normaliseScale(
  scale: { value: number; label: string }[],
): { value: number; label: string }[] {
  const sorted = [...scale].sort((a, b) => a.value - b.value);
  if (new Set(sorted.map((s) => s.value)).size !== sorted.length) {
    throw new BadRequestException('Rating scale values must be unique');
  }
  return sorted;
}
