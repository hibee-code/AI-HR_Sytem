import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { PayrollRunStatus } from '../entities/payroll-run.entity';
import {
  LineMethod,
  LineType,
  PayFrequency,
} from '../entities/salary-structure.entity';

export class StructureLineDto {
  @ApiProperty({ example: 'HOUSING' })
  @Matches(/^[A-Z][A-Z0-9_]{1,29}$/)
  code: string;
  @ApiProperty({ example: 'Housing allowance' })
  @IsString()
  @MaxLength(100)
  label: string;
  @ApiProperty({ enum: LineType }) @IsEnum(LineType) type: LineType;
  @ApiProperty({ enum: LineMethod }) @IsEnum(LineMethod) method: LineMethod;
  @ApiProperty({
    example: 10,
    description: 'Amount or percentage depending on method',
  })
  @IsNumber()
  @Min(0)
  value: number;
}

export class CreateStructureDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId: string;
  @ApiProperty({ example: '2026-01-01' }) @IsDateString() effectiveFrom: string;

  @ApiPropertyOptional({
    example: 'NGN',
    description: 'Defaults to PAYROLL_CURRENCY',
  })
  @IsOptional()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({ enum: PayFrequency, default: PayFrequency.MONTHLY })
  @IsOptional()
  @IsEnum(PayFrequency)
  payFrequency?: PayFrequency;
  @ApiProperty({ example: 850000 }) @IsNumber() @Min(0) baseAmount: number;

  @ApiPropertyOptional({ type: [StructureLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => StructureLineDto)
  lines?: StructureLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateRunDto {
  @ApiProperty({ example: '2026-10-01' }) @IsDateString() periodStart: string;
  @ApiProperty({ example: '2026-10-31' }) @IsDateString() periodEnd: string;
  @ApiProperty({ example: '2026-10-28' }) @IsDateString() payDate: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ example: 'NGN' })
  @IsOptional()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ListRunsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PayrollRunStatus })
  @IsOptional()
  @IsEnum(PayrollRunStatus)
  status?: PayrollRunStatus;
}

export class ListPayslipsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  runId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}
