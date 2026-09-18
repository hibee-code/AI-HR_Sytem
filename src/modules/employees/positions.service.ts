import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CreatePositionDto, UpdatePositionDto } from './dto/department.dto';
import { Department } from './entities/department.entity';
import { Position } from './entities/position.entity';

@Injectable()
export class PositionsService {
  constructor(
    @InjectRepository(Position)
    private readonly positions: Repository<Position>,
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
  ) {}

  findAll(
    filter: { departmentId?: string; includeInactive?: boolean } = {},
  ): Promise<Position[]> {
    return this.positions.find({
      where: {
        ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
        ...(filter.includeInactive ? {} : { isActive: true }),
      },
      relations: { department: true },
      order: { title: 'ASC' },
    });
  }

  async findById(id: string): Promise<Position> {
    const pos = await this.positions.findOne({
      where: { id },
      relations: { department: true },
    });
    if (!pos) throw new NotFoundException('Position not found');
    return pos;
  }

  async create(dto: CreatePositionDto): Promise<Position> {
    await this.assertTitleFree(dto.title, dto.departmentId ?? null);
    if (
      dto.departmentId &&
      !(await this.departments.exists({ where: { id: dto.departmentId } }))
    ) {
      throw new NotFoundException('Department not found');
    }
    return this.positions.save(
      this.positions.create({
        title: dto.title,
        level: dto.level ?? null,
        departmentId: dto.departmentId ?? null,
        isActive: true,
      }),
    );
  }

  async update(id: string, dto: UpdatePositionDto): Promise<Position> {
    const pos = await this.findById(id);
    const nextTitle = dto.title ?? pos.title;
    const nextDept =
      dto.departmentId !== undefined ? dto.departmentId : pos.departmentId;
    if (nextTitle !== pos.title || nextDept !== pos.departmentId) {
      await this.assertTitleFree(nextTitle, nextDept, id);
    }
    if (
      nextDept &&
      !(await this.departments.exists({ where: { id: nextDept } }))
    ) {
      throw new NotFoundException('Department not found');
    }
    pos.title = nextTitle;
    pos.departmentId = nextDept;
    if (dto.level !== undefined) pos.level = dto.level;
    if (dto.isActive !== undefined) pos.isActive = dto.isActive;
    await this.positions.save(pos);
    return this.findById(id);
  }

  /** Title must be unique within its department (or among company-wide positions). */
  private async assertTitleFree(
    title: string,
    departmentId: string | null,
    exceptId?: string,
  ) {
    const clash = await this.positions.findOne({
      where: { title, departmentId: departmentId ?? IsNull() },
    });
    if (clash && clash.id !== exceptId) {
      throw new ConflictException(
        `Position "${title}" already exists in that scope`,
      );
    }
  }
}
