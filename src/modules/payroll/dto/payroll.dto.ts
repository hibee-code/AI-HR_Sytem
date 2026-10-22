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
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/** { "USD": 1550 } — ISO 4217 code → positive rate into the run currency. */
function IsFxRates(): PropertyDecorator {
  return ValidateBy({
    name: 'isFxRates',
    validator: {
      validate: (v: unknown) =>
        !!v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        Object.entries(v).every(
          ([k, r]) =>
            /^[A-Z]{3}$/.test(k) &&
            typeof r === 'number' &&
            Number.isFinite(r) &&
            r > 0,
        ),
      defaultMessage: () =>
        'fxRates must map ISO currency codes to positive numbers, e.g. {"USD": 1550}',
    },
  });
}
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

  @ApiPropertyOptional({
    example: 1800000,
    description: 'Declared annual rent (NGN) for PAYE rent relief',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  annualRent?: number;

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

  @ApiPropertyOptional({
    example: { USD: 1550 },
    description:
      'Rates into the run currency for structures in other currencies; without one they are skipped',
  })
  @IsOptional()
  @IsFxRates()
  fxRates?: Record<string, number>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class SetFxRatesDto {
  @ApiProperty({ example: { USD: 1550, GBP: 1980 } })
  @IsFxRates()
  fxRates: Record<string, number>;
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
