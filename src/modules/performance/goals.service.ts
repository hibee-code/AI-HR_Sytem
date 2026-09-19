import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { EmployeesService } from '../employees/employees.service';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import {
  CreateGoalDto,
  ListGoalsQueryDto,
  UpdateGoalDto,
} from './dto/performance.dto';
import { Goal, GoalStatus } from './entities/goal.entity';

type Role = 'hr' | 'manager' | 'owner' | 'none';

@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(Goal) private readonly goals: Repository<Goal>,
    private readonly employees: EmployeesService,
  ) {}

  async findById(id: string): Promise<Goal> {
    const g = await this.goals.findOne({
      where: { id },
      relations: { employee: true, cycle: true },
    });
    if (!g) throw new NotFoundException('Goal not found');
    return g;
  }

  async list(
    query: ListGoalsQueryDto,
    actor: AuthUser,
  ): Promise<PaginatedResponse<Goal>> {
    const qb = this.goals
      .createQueryBuilder('g')
      .innerJoinAndSelect('g.employee', 'e')
      .leftJoinAndSelect('g.cycle', 'c')
      .orderBy('g.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    if (!actor.permissions.includes(PERMISSIONS.REVIEW_MANAGE_CYCLES)) {
      const me = await this.employees.findByUserId(actor.id);
      if (!me) return new PaginatedResponse([], 0, query);
      const visible = [me.id, ...(await this.reportIds(me.id))];
      qb.andWhere('g.employeeId IN (:...visible)', { visible });
    }
    if (query.employeeId)
      qb.andWhere('g.employeeId = :employeeId', {
        employeeId: query.employeeId,
      });
    if (query.cycleId)
      qb.andWhere('g.cycleId = :cycleId', { cycleId: query.cycleId });
    if (query.status)
      qb.andWhere('g.status = :status', { status: query.status });
    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResponse(data, total, query);
  }

  /** Employees propose (DRAFT); managers/HR creating for a report get ACTIVE straight away. */
  async create(dto: CreateGoalDto, actor: AuthUser): Promise<Goal> {
    const me = await this.employees.findByUserId(actor.id);
    const employeeId = dto.employeeId ?? me?.id;
    if (!employeeId)
      throw new NotFoundException(
        'No employee profile is linked to your login',
      );

    const role = await this.roleFor(employeeId, actor);
    if (role === 'none')
      throw new ForbiddenException(
        'You can only set goals for yourself or your reports',
      );
    await this.assertWeight(employeeId, dto.weight ?? 0);

    const approved = role === 'hr' || role === 'manager';
    return this.goals.save(
      this.goals.create({
        employeeId,
        cycleId: dto.cycleId ?? null,
        title: dto.title,
        description: dto.description ?? null,
        weight: dto.weight ?? 0,
        status: approved ? GoalStatus.ACTIVE : GoalStatus.DRAFT,
        progress: 0,
        dueDate: dto.dueDate ?? null,
        approvedByUserId: approved ? actor.id : null,
        approvedAt: approved ? new Date() : null,
        createdByUserId: actor.id,
      }),
    );
  }

  async update(id: string, dto: UpdateGoalDto, actor: AuthUser): Promise<Goal> {
    const g = await this.findById(id);
    const role = await this.roleFor(g.employeeId, actor);
    if (role === 'none') throw new ForbiddenException();
    if (g.status === GoalStatus.CANCELLED)
      throw new BadRequestException('Goal is cancelled');

    // Owners may only edit content while DRAFT; progress/status any time.
    if (
      role === 'owner' &&
      g.status !== GoalStatus.DRAFT &&
      (dto.title ||
        dto.description !== undefined ||
        dto.weight !== undefined ||
        dto.dueDate !== undefined)
    ) {
      throw new BadRequestException(
        'Approved goals can only be re-scoped by your manager',
      );
    }
    if (dto.weight !== undefined)
      await this.assertWeight(g.employeeId, dto.weight, g.id);

    Object.assign(
      g,
      Object.fromEntries(
        Object.entries(dto).filter(
          ([k, v]) => v !== undefined && k !== 'status',
        ),
      ),
    );
    if (dto.status === GoalStatus.COMPLETED) {
      g.status = GoalStatus.COMPLETED;
      g.progress = 100;
    } else if (dto.status === GoalStatus.CANCELLED) {
      if (role === 'owner' && g.status !== GoalStatus.DRAFT)
        throw new ForbiddenException(
          'Ask your manager to cancel an approved goal',
        );
      g.status = GoalStatus.CANCELLED;
    }
    await this.goals.save(g);
    return this.findById(id);
  }

  async approve(id: string, actor: AuthUser): Promise<Goal> {
    const g = await this.findById(id);
    const role = await this.roleFor(g.employeeId, actor);
    if (role !== 'hr' && role !== 'manager')
      throw new ForbiddenException('Only the manager or HR can approve goals');
    if (g.status !== GoalStatus.DRAFT)
      throw new BadRequestException('Goal is not awaiting approval');
    g.status = GoalStatus.ACTIVE;
    g.approvedByUserId = actor.id;
    g.approvedAt = new Date();
    await this.goals.save(g);
    return this.findById(id);
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    const g = await this.findById(id);
    const role = await this.roleFor(g.employeeId, actor);
    if (role === 'none') throw new ForbiddenException();
    if (role === 'owner' && g.status !== GoalStatus.DRAFT)
      throw new ForbiddenException(
        'Only draft goals can be deleted by their owner',
      );
    await this.goals.remove(g);
  }

  private async roleFor(employeeId: string, actor: AuthUser): Promise<Role> {
    if (actor.permissions.includes(PERMISSIONS.REVIEW_MANAGE_CYCLES))
      return 'hr';
    const me = await this.employees.findByUserId(actor.id);
    if (!me) return 'none';
    if (me.id === employeeId) return 'owner';
    if (
      actor.permissions.includes(PERMISSIONS.REVIEW_WRITE_TEAM) &&
      (await this.employees.isInReportingChain(me.id, employeeId))
    ) {
      return 'manager';
    }
    return 'none';
  }

  /** Active + draft goal weights for an employee may not exceed 100 %. */
  private async assertWeight(
    employeeId: string,
    weight: number,
    exceptId?: string,
  ): Promise<void> {
    const rows = await this.goals.find({
      where: { employeeId, status: In([GoalStatus.DRAFT, GoalStatus.ACTIVE]) },
    });
    const total =
      rows.filter((g) => g.id !== exceptId).reduce((s, g) => s + g.weight, 0) +
      weight;
    if (total > 100)
      throw new BadRequestException(
        `Goal weights would total ${total}%; max is 100%`,
      );
  }

  private async reportIds(managerId: string): Promise<string[]> {
    const rows: { id: string }[] = await this.goals.query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM employees WHERE manager_id = $1
         UNION ALL SELECT e.id FROM employees e JOIN tree t ON e.manager_id = t.id
       ) SELECT id FROM tree LIMIT 5000`,
      [managerId],
    );
    return rows.map((r) => r.id);
  }
}
