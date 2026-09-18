import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';
import { Department } from './entities/department.entity';
import { Employee, EmployeeStatus } from './entities/employee.entity';

export interface DepartmentTreeNode {
  id: string;
  name: string;
  code: string;
  head: { id: string; fullName: string } | null;
  /** Active + onboarding + on-leave employees directly in this department. */
  headcount: number;
  children: DepartmentTreeNode[];
}

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
  ) {}

  findAll(): Promise<Department[]> {
    return this.departments.find({
      relations: { head: true },
      order: { name: 'ASC' },
    });
  }

  async findById(id: string): Promise<Department> {
    const dept = await this.departments.findOne({
      where: { id },
      relations: { head: true, parent: true },
    });
    if (!dept) throw new NotFoundException('Department not found');
    return dept;
  }

  /** Full org tree with headcounts, assembled in memory (one query each). */
  async tree(): Promise<DepartmentTreeNode[]> {
    const [depts, counts] = await Promise.all([
      this.departments.find({ relations: { head: true } }),
      this.employees
        .createQueryBuilder('e')
        .select('e.department_id', 'departmentId')
        .addSelect('COUNT(*)', 'count')
        .where('e.status != :terminated', {
          terminated: EmployeeStatus.TERMINATED,
        })
        .groupBy('e.department_id')
        .getRawMany<{ departmentId: string; count: string }>(),
    ]);
    const countBy = new Map(
      counts.map((c) => [c.departmentId, Number(c.count)]),
    );

    const nodes = new Map<string, DepartmentTreeNode>();
    for (const d of depts) {
      nodes.set(d.id, {
        id: d.id,
        name: d.name,
        code: d.code,
        head: d.head ? { id: d.head.id, fullName: d.head.fullName } : null,
        headcount: countBy.get(d.id) ?? 0,
        children: [],
      });
    }
    const roots: DepartmentTreeNode[] = [];
    for (const d of depts) {
      const node = nodes.get(d.id)!;
      const parent = d.parentId ? nodes.get(d.parentId) : undefined;
      (parent ? parent.children : roots).push(node);
    }
    const sort = (list: DepartmentTreeNode[]) => {
      list.sort((a, b) => a.name.localeCompare(b.name));
      list.forEach((n) => sort(n.children));
    };
    sort(roots);
    return roots;
  }

  async create(dto: CreateDepartmentDto): Promise<Department> {
    await this.assertCodeFree(dto.code);
    if (dto.parentId) await this.findById(dto.parentId);
    if (dto.headEmployeeId) await this.assertEmployeeExists(dto.headEmployeeId);
    return this.departments.save(
      this.departments.create({
        name: dto.name,
        code: dto.code,
        description: dto.description ?? null,
        parentId: dto.parentId ?? null,
        headEmployeeId: dto.headEmployeeId ?? null,
      }),
    );
  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<Department> {
    const dept = await this.findById(id);

    if (dto.code !== undefined && dto.code !== dept.code) {
      await this.assertCodeFree(dto.code);
      dept.code = dto.code;
    }
    if (dto.parentId !== undefined && dto.parentId !== dept.parentId) {
      if (dto.parentId) {
        if (dto.parentId === id)
          throw new BadRequestException(
            'A department cannot be its own parent',
          );
        await this.findById(dto.parentId);
        if (await this.isDescendant(dto.parentId, id)) {
          throw new BadRequestException(
            'Cannot move a department under one of its own descendants',
          );
        }
      }
      dept.parentId = dto.parentId;
    }
    if (dto.headEmployeeId !== undefined) {
      if (dto.headEmployeeId)
        await this.assertEmployeeExists(dto.headEmployeeId);
      dept.headEmployeeId = dto.headEmployeeId;
    }
    if (dto.name !== undefined) dept.name = dto.name;
    if (dto.description !== undefined) dept.description = dto.description;

    await this.departments.save(dept);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    const dept = await this.findById(id);
    const [children, members] = await Promise.all([
      this.departments.count({ where: { parentId: id } }),
      this.employees.count({ where: { departmentId: id } }),
    ]);
    if (children > 0)
      throw new ConflictException(
        'Department has sub-departments; move or delete them first',
      );
    if (members > 0)
      throw new ConflictException(
        'Department has employees; transfer them first',
      );
    await this.departments.remove(dept);
  }

  /** True if `candidateId` is somewhere below `ancestorId` in the tree. */
  private async isDescendant(
    candidateId: string,
    ancestorId: string,
  ): Promise<boolean> {
    const rows = await this.departments.query(
      `WITH RECURSIVE sub AS (
         SELECT id FROM departments WHERE parent_id = $1
         UNION ALL
         SELECT d.id FROM departments d JOIN sub ON d.parent_id = sub.id
       )
       SELECT 1 FROM sub WHERE id = $2 LIMIT 1`,
      [ancestorId, candidateId],
    );
    return rows.length > 0;
  }

  private async assertCodeFree(code: string): Promise<void> {
    if (await this.departments.exists({ where: { code } })) {
      throw new ConflictException(`Department code ${code} is already in use`);
    }
  }

  private async assertEmployeeExists(id: string): Promise<void> {
    const ok = await this.employees.exists({
      where: {
        id,
        status: Not(EmployeeStatus.TERMINATED),
        deletedAt: IsNull(),
      },
    });
    if (!ok)
      throw new BadRequestException('Head employee not found or not active');
  }
}
