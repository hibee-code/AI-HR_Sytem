import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { RbacService } from '../rbac/rbac.service';
import {
  CreateTemplateDto,
  TemplateItemDto,
  UpdateTemplateDto,
  UpdateTemplateItemDto,
} from './dto/onboarding.dto';
import { ChecklistTemplateItem } from './entities/checklist-template-item.entity';
import {
  AssigneeRule,
  ChecklistTemplate,
  ChecklistType,
} from './entities/checklist-template.entity';

@Injectable()
export class ChecklistTemplatesService {
  constructor(
    @InjectRepository(ChecklistTemplate)
    private readonly templates: Repository<ChecklistTemplate>,
    @InjectRepository(ChecklistTemplateItem)
    private readonly items: Repository<ChecklistTemplateItem>,
    private readonly rbac: RbacService,
  ) {}

  findAll(
    filter: { type?: ChecklistType; includeInactive?: boolean } = {},
  ): Promise<ChecklistTemplate[]> {
    return this.templates.find({
      where: {
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.includeInactive ? {} : { isActive: true }),
      },
      relations: { items: true, department: true },
      order: { type: 'ASC', name: 'ASC', items: { sortOrder: 'ASC' } },
    });
  }

  async findById(id: string): Promise<ChecklistTemplate> {
    const t = await this.templates.findOne({
      where: { id },
      relations: { items: true, department: true },
      order: { items: { sortOrder: 'ASC' } },
    });
    if (!t) throw new NotFoundException('Checklist template not found');
    return t;
  }

  /** Department-specific active template first, then the company-wide one. */
  async resolveFor(
    type: ChecklistType,
    departmentId: string,
  ): Promise<ChecklistTemplate | null> {
    return (
      (await this.templates.findOne({
        where: { type, departmentId, isActive: true },
        relations: { items: true },
        order: { items: { sortOrder: 'ASC' } },
      })) ??
      (await this.templates.findOne({
        where: { type, departmentId: IsNull(), isActive: true },
        relations: { items: true },
        order: { items: { sortOrder: 'ASC' } },
      }))
    );
  }

  async create(dto: CreateTemplateDto): Promise<ChecklistTemplate> {
    for (const item of dto.items ?? []) await this.validateItem(item);
    const template = this.templates.create({
      name: dto.name,
      type: dto.type,
      description: dto.description ?? null,
      departmentId: dto.departmentId ?? null,
      isActive: true,
      items: (dto.items ?? []).map((i, idx) =>
        this.items.create(this.toItem(i, idx)),
      ),
    });
    const saved = await this.templates.save(template);
    return this.findById(saved.id);
  }

  async update(id: string, dto: UpdateTemplateDto): Promise<ChecklistTemplate> {
    const t = await this.findById(id);
    if (dto.name !== undefined) t.name = dto.name;
    if (dto.type !== undefined) t.type = dto.type;
    if (dto.description !== undefined) t.description = dto.description;
    if (dto.departmentId !== undefined) t.departmentId = dto.departmentId;
    if (dto.isActive !== undefined) t.isActive = dto.isActive;
    if (dto.items !== undefined) {
      for (const item of dto.items) await this.validateItem(item);
      await this.items.delete({ templateId: id });
      t.items = dto.items.map((i, idx) =>
        this.items.create(this.toItem(i, idx)),
      );
    }
    await this.templates.save(t);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    await this.templates.remove(await this.findById(id));
  }

  async addItem(
    templateId: string,
    dto: TemplateItemDto,
  ): Promise<ChecklistTemplate> {
    await this.findById(templateId);
    await this.validateItem(dto);
    const count = await this.items.count({ where: { templateId } });
    await this.items.save(
      this.items.create({ ...this.toItem(dto, count), templateId }),
    );
    return this.findById(templateId);
  }

  async updateItem(
    itemId: string,
    dto: UpdateTemplateItemDto,
  ): Promise<ChecklistTemplate> {
    const item = await this.items.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Template item not found');
    const merged: TemplateItemDto = {
      title: dto.title ?? item.title,
      description: dto.description ?? item.description ?? undefined,
      assigneeRule: dto.assigneeRule ?? item.assigneeRule,
      assigneeRoleName:
        dto.assigneeRoleName ?? item.assigneeRoleName ?? undefined,
      dueOffsetDays: dto.dueOffsetDays ?? item.dueOffsetDays,
      sortOrder: dto.sortOrder ?? item.sortOrder,
      isRequired: dto.isRequired ?? item.isRequired,
    };
    await this.validateItem(merged);
    Object.assign(item, this.toItem(merged, dto.sortOrder ?? item.sortOrder));
    await this.items.save(item);
    return this.findById(item.templateId);
  }

  async removeItem(itemId: string): Promise<ChecklistTemplate> {
    const item = await this.items.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Template item not found');
    await this.items.remove(item);
    return this.findById(item.templateId);
  }

  private toItem(
    dto: TemplateItemDto,
    defaultOrder: number,
  ): Partial<ChecklistTemplateItem> {
    return {
      title: dto.title,
      description: dto.description ?? null,
      assigneeRule: dto.assigneeRule,
      assigneeRoleName:
        dto.assigneeRule === AssigneeRule.ROLE
          ? dto.assigneeRoleName!
          : dto.assigneeRule === AssigneeRule.HR
            ? 'HR_MANAGER'
            : null,
      dueOffsetDays: dto.dueOffsetDays ?? 0,
      sortOrder: dto.sortOrder ?? defaultOrder,
      isRequired: dto.isRequired ?? true,
    };
  }

  private async validateItem(dto: TemplateItemDto): Promise<void> {
    if (dto.assigneeRule === AssigneeRule.ROLE) {
      if (!dto.assigneeRoleName)
        throw new BadRequestException(
          'assigneeRoleName is required for ROLE items',
        );
      await this.rbac.findRolesByNames([dto.assigneeRoleName]); // 400 if unknown
    }
  }
}
