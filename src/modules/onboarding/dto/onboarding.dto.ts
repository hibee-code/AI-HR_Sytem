import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { TaskStatus } from '../entities/checklist-task.entity';
import {
  AssigneeRule,
  ChecklistType,
} from '../entities/checklist-template.entity';
import { ChecklistStatus } from '../entities/checklist.entity';

// ── Templates ────────────────────────────────────────────────────────────

export class TemplateItemDto {
  @ApiProperty({ example: 'Sign employment contract' })
  @IsString()
  @MaxLength(200)
  title: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ enum: AssigneeRule })
  @IsEnum(AssigneeRule)
  assigneeRule: AssigneeRule;

  @ApiPropertyOptional({
    example: 'IT_SUPPORT',
    description: 'Required when assigneeRule = ROLE',
  })
  @ValidateIf((o: TemplateItemDto) => o.assigneeRule === AssigneeRule.ROLE)
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/)
  assigneeRoleName?: string;

  @ApiPropertyOptional({
    default: 0,
    description: 'Days from anchor date; negative = before',
  })
  @IsOptional()
  @IsInt()
  @Min(-365)
  @Max(365)
  dueOffsetDays?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}

export class UpdateTemplateItemDto extends PartialType(TemplateItemDto) {}

export class CreateTemplateDto {
  @ApiProperty() @IsString() @MaxLength(100) name: string;
  @ApiProperty({ enum: ChecklistType })
  @IsEnum(ChecklistType)
  type: ChecklistType;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'null = company-wide',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ type: [TemplateItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateItemDto)
  items?: TemplateItemDto[];
}

export class UpdateTemplateDto extends PartialType(CreateTemplateDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ── Checklists & tasks ───────────────────────────────────────────────────

export class StartChecklistDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId: string;
  @ApiProperty({ enum: ChecklistType })
  @IsEnum(ChecklistType)
  type: ChecklistType;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Defaults to the best matching active template',
  })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({
    description: 'Defaults to hire date / termination date',
  })
  @IsOptional()
  @IsDateString()
  anchorDate?: string;
}

export class ListChecklistsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
  @ApiPropertyOptional({ enum: ChecklistType })
  @IsOptional()
  @IsEnum(ChecklistType)
  type?: ChecklistType;
  @ApiPropertyOptional({ enum: ChecklistStatus })
  @IsOptional()
  @IsEnum(ChecklistStatus)
  status?: ChecklistStatus;
}

export class UpdateTaskDto {
  @ApiPropertyOptional({ enum: TaskStatus })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  documentId?: string | null;
}

export class ReassignTaskDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'null clears the user assignee',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  assigneeUserId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/)
  assigneeRoleName?: string | null;
}
