import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateDepartmentDto {
  @ApiProperty({ example: 'Engineering' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: 'ENG',
    description: 'Uppercase letters, digits, underscores',
  })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{0,19}$/, {
    message: 'code must be UPPER_CASE (max 20)',
  })
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  headEmployeeId?: string | null;
}

export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

export class CreatePositionDto {
  @ApiProperty({ example: 'Senior Backend Engineer' })
  @IsString()
  @MaxLength(100)
  title: string;

  @ApiPropertyOptional({ example: 'L4' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  level?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'null = company-wide',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;
}

export class UpdatePositionDto extends PartialType(CreatePositionDto) {
  @ApiPropertyOptional()
  @IsOptional()
  isActive?: boolean;
}
