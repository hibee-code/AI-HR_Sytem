import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  OmitType,
} from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ALL_PERMISSIONS, Permission } from '../permissions.catalogue';

export class CreateRoleDto {
  @ApiProperty({
    example: 'PAYROLL_CLERK',
    description: 'UPPER_SNAKE_CASE identifier',
  })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, {
    message: 'name must be UPPER_SNAKE_CASE',
  })
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions: Permission[];
}

export class UpdateRoleDto extends PartialType(
  OmitType(CreateRoleDto, ['name'] as const),
) {}
