import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsHalfStep } from '../../../common/validators/is-half-step.validator';
import { HalfDay, LeaveRequestStatus } from '../entities/leave-request.entity';

// ── Policy ───────────────────────────────────────────────────────────────

export class CreateLeaveTypeDto {
  @ApiProperty({ example: 'ANNUAL' })
  @Matches(/^[A-Z][A-Z0-9_]{1,29}$/, { message: 'code must be UPPER_CASE' })
  code: string;

  @ApiProperty({ example: 'Annual leave' })
  @IsString()
  @MaxLength(100)
  name: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 20 })
  @IsNumber()
  @Min(0)
  @Max(365)
  @IsHalfStep()
  defaultDays: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  requiresBalance?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(365)
  @IsHalfStep()
  carryOverMaxDays?: number;

  @ApiPropertyOptional({ example: '03-31', nullable: true })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Matches(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'expected MM-DD',
  })
  carryOverExpiresOn?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  allowHalfDay?: boolean;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateLeaveTypeDto extends PartialType(CreateLeaveTypeDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class PublicHolidayDto {
  @ApiProperty({ example: '2026-12-25' }) @IsDateString() date: string;
  @ApiProperty({ example: 'Christmas Day' })
  @IsString()
  @MaxLength(100)
  name: string;
}

export class AdjustBalanceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() leaveTypeId: string;
  @ApiProperty({ example: 2026 }) @IsInt() @Min(2000) @Max(2100) year: number;

  @ApiProperty({
    example: -1.5,
    description: 'Days to add (negative to remove)',
  })
  @IsNumber()
  @Min(-365)
  @Max(365)
  @IsHalfStep()
  delta: number;

  @ApiProperty() @IsString() @MaxLength(500) reason: string;
}

// ── Requests ─────────────────────────────────────────────────────────────

export class CreateLeaveRequestDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() leaveTypeId: string;
  @ApiProperty({ example: '2026-12-21' }) @IsDateString() startDate: string;
  @ApiProperty({ example: '2026-12-24' }) @IsDateString() endDate: string;

  @ApiPropertyOptional({
    enum: HalfDay,
    default: HalfDay.NONE,
    description: 'Single-day requests only',
  })
  @IsOptional()
  @IsEnum(HalfDay)
  halfDay?: HalfDay;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  attachmentDocumentId?: string;
}

/** HR can file on someone's behalf. */
export class CreateLeaveRequestForDto extends CreateLeaveRequestDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId: string;
}

export class DecideLeaveRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListLeaveRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;
  @ApiPropertyOptional({ enum: LeaveRequestStatus })
  @IsOptional()
  @IsEnum(LeaveRequestStatus)
  status?: LeaveRequestStatus;
  @ApiPropertyOptional({ description: 'Overlap window start' })
  @IsOptional()
  @IsDateString()
  from?: string;
  @ApiPropertyOptional({ description: 'Overlap window end' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class BalanceQueryDto {
  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}
