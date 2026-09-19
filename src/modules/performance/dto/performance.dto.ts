import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { GoalStatus } from '../entities/goal.entity';
import { CyclePhase } from '../entities/review-cycle.entity';
import { ReviewStatus } from '../entities/review.entity';

// ── Cycles ───────────────────────────────────────────────────────────────

export class RatingLevelDto {
  @ApiProperty({ example: 3 }) @IsInt() @Min(1) @Max(10) value: number;
  @ApiProperty({ example: 'Meets expectations' })
  @IsString()
  @MaxLength(50)
  label: string;
}

export class CreateCycleDto {
  @ApiProperty({ example: 'H2 2026' }) @IsString() @MaxLength(100) name: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
  @ApiProperty({ example: '2026-07-01' }) @IsDateString() periodStart: string;
  @ApiProperty({ example: '2026-12-31' }) @IsDateString() periodEnd: string;
  @ApiProperty({ example: '2027-01-15' })
  @IsDateString()
  selfReviewDeadline: string;
  @ApiProperty({ example: '2027-01-31' })
  @IsDateString()
  managerReviewDeadline: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({
    type: [RatingLevelDto],
    description: 'Defaults to a 1–5 scale',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RatingLevelDto)
  ratingScale?: RatingLevelDto[];

  @ApiPropertyOptional({
    type: [String],
    example: ['Ownership', 'Collaboration', 'Craft'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  competencies?: string[];
}

export class UpdateCycleDto extends PartialType(CreateCycleDto) {}

export class ListCyclesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CyclePhase })
  @IsOptional()
  @IsEnum(CyclePhase)
  phase?: CyclePhase;
}

// ── Goals ────────────────────────────────────────────────────────────────

export class CreateGoalDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Defaults to the caller’s own employee',
  })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  cycleId?: string | null;

  @ApiProperty() @IsString() @MaxLength(200) title: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  weight?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
}

export class UpdateGoalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  weight?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;
  @ApiPropertyOptional({ enum: [GoalStatus.COMPLETED, GoalStatus.CANCELLED] })
  @IsOptional()
  @IsEnum([GoalStatus.COMPLETED, GoalStatus.CANCELLED])
  status?: GoalStatus.COMPLETED | GoalStatus.CANCELLED;
}

export class ListGoalsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cycleId?: string;
  @ApiPropertyOptional({ enum: GoalStatus })
  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;
}

// ── Reviews ──────────────────────────────────────────────────────────────

export class AssessmentDto {
  @ApiProperty() @IsString() @MaxLength(5000) summary: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  achievements?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  challenges?: string;

  @ApiProperty({
    example: { Ownership: 4, Collaboration: 3 },
    description: 'Score per cycle competency',
  })
  @IsObject()
  competencies: Record<string, number>;

  @ApiProperty({ example: 4, description: 'Overall rating on the cycle scale' })
  @IsInt()
  @Min(1)
  @Max(10)
  rating: number;
}

export class CalibrateDto {
  @ApiProperty({ example: 4 }) @IsInt() @Min(1) @Max(10) finalRating: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AcknowledgeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class ReassignReviewerDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'null = HR writes the assessment',
  })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  reviewerUserId: string | null;
}

export class ListReviewsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cycleId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;
}

// ── Feedback ─────────────────────────────────────────────────────────────

export class RequestFeedbackDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Logins asked for feedback',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  giverUserIds: string[];
}

export class SubmitFeedbackDto {
  @ApiProperty() @IsString() @MaxLength(5000) strengths: string;
  @ApiProperty() @IsString() @MaxLength(5000) improvements: string;
  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  rating?: number;
}
