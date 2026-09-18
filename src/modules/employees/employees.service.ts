import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, IsNull, Not, Repository } from 'typeorm';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { AuthService } from '../auth/auth.service';
import { RbacService } from '../rbac/rbac.service';
import { UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import {
  AssignmentChangeDto,
  ChangeStatusDto,
  CreateEmployeeDto,
  ListEmployeesQueryDto,
  TerminateEmployeeDto,
  UpdateEmployeeDto,
  UpdateSelfDto,
} from './dto/employee.dto';
import { Department } from './entities/department.entity';
import {
  Employee,
  EmployeeStatus,
  EmploymentType,
} from './entities/employee.entity';
import {
  EmploymentChangeType,
  EmploymentHistory,
} from './entities/employment-history.entity';
import { Position } from './entities/position.entity';
import {
  EMPLOYEE_EVENTS,
  EmployeeAssignmentChangedEvent,
  EmployeeCreatedEvent,
  EmployeeStatusChangedEvent,
  EmployeeTerminatedEvent,
} from './employees.events';

export interface OrgChartNode {
  id: string;
  employeeNumber: string;
  fullName: string;
  photoUrl: string | null;
  position: string | null;
  department: string;
  children: OrgChartNode[];
}

/** Legal status transitions outside hire/termination. */
const STATUS_TRANSITIONS: Record<EmployeeStatus, EmployeeStatus[]> = {
  [EmployeeStatus.ONBOARDING]: [EmployeeStatus.ACTIVE],
  [EmployeeStatus.ACTIVE]: [EmployeeStatus.ON_LEAVE],
  [EmployeeStatus.ON_LEAVE]: [EmployeeStatus.ACTIVE],
  [EmployeeStatus.TERMINATED]: [],
};

const NOT_TERMINATED = {
  status: Not(EmployeeStatus.TERMINATED),
  deletedAt: IsNull(),
};

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(EmploymentHistory)
    private readonly history: Repository<EmploymentHistory>,
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
    @InjectRepository(Position)
    private readonly positions: Repository<Position>,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly rbac: RbacService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────

  async findById(id: string): Promise<Employee> {
    const emp = await this.employees.findOne({
      where: { id },
      relations: { department: true, position: true, manager: true },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    return emp;
  }

  findByUserId(userId: string): Promise<Employee | null> {
    return this.employees.findOne({
      where: { userId },
      relations: { department: true, position: true, manager: true },
    });
  }

  async list(
    query: ListEmployeesQueryDto,
  ): Promise<PaginatedResponse<Employee>> {
    const qb = this.employees
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.department', 'd')
      .leftJoinAndSelect('e.position', 'p')
      .leftJoinAndSelect('e.manager', 'm')
      .orderBy('e.lastName', 'ASC')
      .addOrderBy('e.firstName', 'ASC')
      .skip(query.skip)
      .take(query.limit);

    if (query.departmentId)
      qb.andWhere('e.departmentId = :departmentId', {
        departmentId: query.departmentId,
      });
    if (query.managerId)
      qb.andWhere('e.managerId = :managerId', { managerId: query.managerId });
    if (query.status) {
      qb.andWhere('e.status = :status', { status: query.status });
    } else if (!query.includeTerminated) {
      qb.andWhere('e.status != :terminated', {
        terminated: EmployeeStatus.TERMINATED,
      });
    }
    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('e.firstName ILIKE :s')
            .orWhere('e.lastName ILIKE :s')
            .orWhere("e.firstName || ' ' || e.lastName ILIKE :s")
            .orWhere('e.workEmail ILIKE :s')
            .orWhere('e.employeeNumber ILIKE :s');
        }),
        { s: `%${query.search}%` },
      );
    }

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResponse(data, total, query);
  }

  directReports(managerId: string): Promise<Employee[]> {
    return this.employees.find({
      where: { managerId, ...NOT_TERMINATED },
      relations: { department: true, position: true },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });
  }

  historyFor(employeeId: string): Promise<EmploymentHistory[]> {
    return this.history.find({
      where: { employeeId },
      relations: {
        fromDepartment: true,
        toDepartment: true,
        fromPosition: true,
        toPosition: true,
        fromManager: true,
        toManager: true,
      },
      order: { effectiveDate: 'DESC', createdAt: 'DESC' },
    });
  }

  /** Does `targetId` report — directly or through any number of levels — to `managerId`? */
  async isInReportingChain(
    managerId: string,
    targetId: string,
  ): Promise<boolean> {
    if (managerId === targetId) return false;
    const rows: { found: number }[] = await this.employees.query(
      `WITH RECURSIVE chain AS (
         SELECT manager_id, 1 AS depth FROM employees WHERE id = $1
         UNION ALL
         SELECT e.manager_id, c.depth + 1 FROM employees e
           JOIN chain c ON e.id = c.manager_id
           WHERE c.manager_id IS NOT NULL AND c.depth < 50
       )
       SELECT 1 AS found FROM chain WHERE manager_id = $2 LIMIT 1`,
      [targetId, managerId],
    );
    return rows.length > 0;
  }

  /** Reporting-line tree. Without a root, starts from everyone who has no manager. */
  async orgChart(rootId?: string): Promise<OrgChartNode[]> {
    if (rootId) await this.findById(rootId);
    const rows: {
      id: string;
      manager_id: string | null;
      employee_number: string;
      first_name: string;
      last_name: string;
      photo_url: string | null;
      position: string | null;
      department: string;
    }[] = await this.employees.query(
      `WITH RECURSIVE tree AS (
         SELECT e.id, e.manager_id, 0 AS depth FROM employees e
           WHERE e.deleted_at IS NULL AND e.status != 'TERMINATED'
             AND ${rootId ? 'e.id = $1' : 'e.manager_id IS NULL'}
         UNION ALL
         SELECT e.id, e.manager_id, t.depth + 1 FROM employees e
           JOIN tree t ON e.manager_id = t.id
           WHERE e.deleted_at IS NULL AND e.status != 'TERMINATED' AND t.depth < 50
       )
       SELECT e.id, e.manager_id, e.employee_number, e.first_name, e.last_name, e.photo_url,
              p.title AS position, d.name AS department
       FROM tree t
       JOIN employees e ON e.id = t.id
       JOIN departments d ON d.id = e.department_id
       LEFT JOIN positions p ON p.id = e.position_id
       ORDER BY e.last_name, e.first_name`,
      rootId ? [rootId] : [],
    );

    const nodes = new Map<string, OrgChartNode>();
    for (const r of rows) {
      nodes.set(r.id, {
        id: r.id,
        employeeNumber: r.employee_number,
        fullName: `${r.first_name} ${r.last_name}`.trim(),
        photoUrl: r.photo_url,
        position: r.position,
        department: r.department,
        children: [],
      });
    }
    const roots: OrgChartNode[] = [];
    for (const r of rows) {
      const node = nodes.get(r.id)!;
      const parent = r.manager_id ? nodes.get(r.manager_id) : undefined;
      (parent && r.id !== rootId ? parent.children : roots).push(node);
    }
    return roots;
  }

  // ── Hire ──────────────────────────────────────────────────────────────

  async create(dto: CreateEmployeeDto, actorUserId: string): Promise<Employee> {
    await this.assertWorkEmailFree(dto.workEmail);
    await this.assertDepartmentExists(dto.departmentId);
    if (dto.positionId)
      await this.assertPositionAssignable(dto.positionId, dto.departmentId);
    if (dto.managerId) await this.assertManagerAssignable(dto.managerId);
    if (dto.userId && dto.inviteLogin) {
      throw new BadRequestException(
        'Provide either userId or inviteLogin, not both',
      );
    }
    if (dto.userId) await this.assertUserLinkable(dto.userId);
    if (dto.inviteLogin) {
      if (await this.users.findByEmail(dto.workEmail)) {
        throw new ConflictException(
          'A login with this work email already exists; pass userId instead',
        );
      }
      await this.rbac.findRolesByNames(dto.inviteLogin.roles);
    }

    const status = dto.status ?? EmployeeStatus.ONBOARDING;
    const employee = await this.employees.manager.transaction(async (em) => {
      const saved = await em.save(
        Employee,
        em.create(Employee, {
          employeeNumber: await this.nextEmployeeNumber(em),
          userId: dto.userId ?? null,
          firstName: dto.firstName,
          lastName: dto.lastName,
          workEmail: dto.workEmail,
          personalEmail: dto.personalEmail ?? null,
          phone: dto.phone ?? null,
          dateOfBirth: dto.dateOfBirth ?? null,
          address: dto.address ?? null,
          emergencyContact: dto.emergencyContact ?? null,
          photoUrl: null,
          hireDate: dto.hireDate,
          terminationDate: null,
          status,
          employmentType: dto.employmentType ?? EmploymentType.FULL_TIME,
          departmentId: dto.departmentId,
          positionId: dto.positionId ?? null,
          managerId: dto.managerId ?? null,
        }),
      );
      await em.save(
        EmploymentHistory,
        em.create(EmploymentHistory, {
          employeeId: saved.id,
          changeType: EmploymentChangeType.HIRE,
          effectiveDate: dto.hireDate,
          toDepartmentId: saved.departmentId,
          toPositionId: saved.positionId,
          toManagerId: saved.managerId,
          toStatus: status,
          notes: null,
          changedByUserId: actorUserId,
        }),
      );
      return saved;
    });

    if (dto.inviteLogin) {
      const user = await this.auth.invite({
        email: dto.workEmail,
        firstName: dto.firstName,
        lastName: dto.lastName,
        roles: dto.inviteLogin.roles,
      });
      employee.userId = user.id;
      await this.employees.update(employee.id, { userId: user.id });
    }

    this.events.emit(
      EMPLOYEE_EVENTS.CREATED,
      new EmployeeCreatedEvent(
        employee.id,
        employee.userId,
        employee.hireDate,
        employee.departmentId,
        employee.managerId,
        actorUserId,
      ),
    );
    return this.findById(employee.id);
  }

  // ── Profile ───────────────────────────────────────────────────────────

  async updateProfile(id: string, dto: UpdateEmployeeDto): Promise<Employee> {
    const emp = await this.findById(id);
    if (dto.workEmail !== undefined && dto.workEmail !== emp.workEmail) {
      await this.assertWorkEmailFree(dto.workEmail);
    }
    Object.assign(emp, stripUndefined(dto));
    await this.employees.save(emp);
    return this.findById(id);
  }

  async updateSelf(userId: string, dto: UpdateSelfDto): Promise<Employee> {
    const emp = await this.findByUserId(userId);
    if (!emp)
      throw new NotFoundException(
        'No employee profile is linked to your login',
      );
    Object.assign(emp, stripUndefined(dto));
    await this.employees.save(emp);
    return this.findById(emp.id);
  }

  // ── Org placement ─────────────────────────────────────────────────────

  async changeAssignment(
    id: string,
    dto: AssignmentChangeDto,
    actorUserId: string,
  ): Promise<Employee> {
    const emp = await this.findById(id);
    this.assertNotTerminated(emp);

    const nextDepartmentId = dto.departmentId ?? emp.departmentId;
    const nextPositionId =
      dto.positionId !== undefined ? dto.positionId : emp.positionId;
    const nextManagerId =
      dto.managerId !== undefined ? dto.managerId : emp.managerId;

    const changed =
      nextDepartmentId !== emp.departmentId ||
      nextPositionId !== emp.positionId ||
      nextManagerId !== emp.managerId;
    if (!changed)
      throw new BadRequestException(
        'Nothing changes: department, position and manager are unchanged',
      );

    if (nextDepartmentId !== emp.departmentId)
      await this.assertDepartmentExists(nextDepartmentId);
    if (nextPositionId && nextPositionId !== emp.positionId) {
      await this.assertPositionAssignable(nextPositionId, nextDepartmentId);
    }
    if (nextManagerId && nextManagerId !== emp.managerId) {
      await this.assertManagerAssignable(nextManagerId, emp.id);
    }

    const record = await this.employees.manager.transaction(async (em) => {
      await em.update(Employee, id, {
        departmentId: nextDepartmentId,
        positionId: nextPositionId,
        managerId: nextManagerId,
      });
      return em.save(
        EmploymentHistory,
        em.create(EmploymentHistory, {
          employeeId: id,
          changeType: dto.changeType,
          effectiveDate: dto.effectiveDate,
          fromDepartmentId:
            nextDepartmentId !== emp.departmentId ? emp.departmentId : null,
          toDepartmentId:
            nextDepartmentId !== emp.departmentId ? nextDepartmentId : null,
          fromPositionId:
            nextPositionId !== emp.positionId ? emp.positionId : null,
          toPositionId:
            nextPositionId !== emp.positionId ? nextPositionId : null,
          fromManagerId: nextManagerId !== emp.managerId ? emp.managerId : null,
          toManagerId: nextManagerId !== emp.managerId ? nextManagerId : null,
          notes: dto.notes ?? null,
          changedByUserId: actorUserId,
        }),
      );
    });

    this.events.emit(
      EMPLOYEE_EVENTS.ASSIGNMENT_CHANGED,
      new EmployeeAssignmentChangedEvent(
        id,
        dto.changeType,
        dto.effectiveDate,
        record.id,
        actorUserId,
      ),
    );
    return this.findById(id);
  }

  /** `actorUserId` null = automated (e.g. onboarding checklist completion). */
  async changeStatus(
    id: string,
    dto: ChangeStatusDto,
    actorUserId: string | null,
  ): Promise<Employee> {
    const emp = await this.findById(id);
    if (!STATUS_TRANSITIONS[emp.status].includes(dto.status)) {
      throw new BadRequestException(
        `Cannot change status from ${emp.status} to ${dto.status}`,
      );
    }
    const from = emp.status;
    await this.employees.manager.transaction(async (em) => {
      await em.update(Employee, id, { status: dto.status });
      await em.save(
        EmploymentHistory,
        em.create(EmploymentHistory, {
          employeeId: id,
          changeType: EmploymentChangeType.STATUS_CHANGE,
          effectiveDate: dto.effectiveDate,
          fromStatus: from,
          toStatus: dto.status,
          notes: dto.notes ?? null,
          changedByUserId: actorUserId,
        }),
      );
    });
    this.events.emit(
      EMPLOYEE_EVENTS.STATUS_CHANGED,
      new EmployeeStatusChangedEvent(
        id,
        from,
        dto.status,
        dto.effectiveDate,
        actorUserId,
      ),
    );
    return this.findById(id);
  }

  /**
   * Ends employment. Direct reports move up to the leaver's manager, any
   * department headship is cleared, and (by default) the login is suspended.
   */
  async terminate(
    id: string,
    dto: TerminateEmployeeDto,
    actorUserId: string,
  ): Promise<Employee> {
    const emp = await this.findById(id);
    this.assertNotTerminated(emp);
    if (dto.terminationDate < emp.hireDate) {
      throw new BadRequestException(
        'Termination date cannot precede the hire date',
      );
    }

    await this.employees.manager.transaction(async (em) => {
      await em.update(Employee, id, {
        status: EmployeeStatus.TERMINATED,
        terminationDate: dto.terminationDate,
      });
      await em.update(
        Employee,
        { managerId: id },
        { managerId: emp.managerId },
      );
      await em.update(
        Department,
        { headEmployeeId: id },
        { headEmployeeId: null },
      );
      await em.save(
        EmploymentHistory,
        em.create(EmploymentHistory, {
          employeeId: id,
          changeType: EmploymentChangeType.TERMINATION,
          effectiveDate: dto.terminationDate,
          fromStatus: emp.status,
          toStatus: EmployeeStatus.TERMINATED,
          notes: dto.reason ?? null,
          changedByUserId: actorUserId,
        }),
      );
    });

    if (
      emp.userId &&
      (dto.suspendLogin ?? true) &&
      emp.userId !== actorUserId
    ) {
      const user = await this.users.findById(emp.userId);
      if (user.status === UserStatus.ACTIVE) {
        await this.users.setStatus(
          emp.userId,
          UserStatus.SUSPENDED,
          actorUserId,
        );
        await this.auth.logoutAll(emp.userId);
      }
    }

    this.events.emit(
      EMPLOYEE_EVENTS.TERMINATED,
      new EmployeeTerminatedEvent(
        id,
        emp.userId,
        dto.terminationDate,
        actorUserId,
      ),
    );
    return this.findById(id);
  }

  // ── Login linking ─────────────────────────────────────────────────────

  async linkUser(id: string, userId: string): Promise<Employee> {
    const emp = await this.findById(id);
    if (emp.userId)
      throw new ConflictException('Employee already has a linked login');
    await this.assertUserLinkable(userId);
    await this.employees.update(id, { userId });
    return this.findById(id);
  }

  // ── Invariants ────────────────────────────────────────────────────────

  private async nextEmployeeNumber(em: EntityManager): Promise<string> {
    const [{ nextval }] = await em.query(
      `SELECT nextval('employee_number_seq') AS nextval`,
    );
    return `EMP-${String(nextval).padStart(4, '0')}`;
  }

  private async assertWorkEmailFree(email: string): Promise<void> {
    if (
      await this.employees.exists({
        where: { workEmail: email },
        withDeleted: true,
      })
    ) {
      throw new ConflictException(
        'An employee with this work email already exists',
      );
    }
  }

  private async assertDepartmentExists(id: string): Promise<void> {
    if (!(await this.departments.exists({ where: { id } }))) {
      throw new NotFoundException('Department not found');
    }
  }

  private async assertPositionAssignable(
    positionId: string,
    departmentId: string,
  ): Promise<void> {
    const pos = await this.positions.findOne({ where: { id: positionId } });
    if (!pos) throw new NotFoundException('Position not found');
    if (!pos.isActive) throw new BadRequestException('Position is inactive');
    if (pos.departmentId && pos.departmentId !== departmentId) {
      throw new BadRequestException(
        'Position belongs to a different department',
      );
    }
  }

  private async assertManagerAssignable(
    managerId: string,
    employeeId?: string,
  ): Promise<void> {
    if (managerId === employeeId)
      throw new BadRequestException('An employee cannot manage themselves');
    if (
      !(await this.employees.exists({
        where: { id: managerId, ...NOT_TERMINATED },
      }))
    ) {
      throw new BadRequestException('Manager not found or no longer employed');
    }
    if (employeeId && (await this.isInReportingChain(employeeId, managerId))) {
      throw new BadRequestException(
        'That would create a reporting cycle: the manager reports to this employee',
      );
    }
  }

  private async assertUserLinkable(userId: string): Promise<void> {
    await this.users.findById(userId); // 404 if missing
    if (await this.employees.exists({ where: { userId }, withDeleted: true })) {
      throw new ConflictException(
        'That login is already linked to another employee',
      );
    }
  }

  private assertNotTerminated(emp: Employee): void {
    if (emp.status === EmployeeStatus.TERMINATED) {
      throw new BadRequestException('Employee is terminated');
    }
  }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
