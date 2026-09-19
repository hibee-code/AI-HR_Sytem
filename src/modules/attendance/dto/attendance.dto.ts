import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class ClockDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ManualRecordDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId: string;
  @ApiProperty({ example: '2026-10-05T08:00:00Z' })
  @IsISO8601()
  clockIn: string;

  @ApiPropertyOptional({
    example: '2026-10-05T17:00:00Z',
    nullable: true,
    description: 'omit/null = still open',
  })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsISO8601()
  clockOut?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateRecordDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() clockIn?: string;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsISO8601()
  clockOut?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class RangeQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ReportQueryDto {
  @ApiProperty({ example: '2026-10', description: 'YYYY-MM' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
