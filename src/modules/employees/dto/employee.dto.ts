import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  PickType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsISO31661Alpha2,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { EmployeeStatus, EmploymentType } from '../entities/employee.entity';
import { EmploymentChangeType } from '../entities/employment-history.entity';

export class AddressDto {
  @ApiProperty() @IsString() @MaxLength(200) line1: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string;
  @ApiProperty() @IsString() @MaxLength(100) city: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;
  @ApiProperty({ example: 'NG', description: 'ISO 3166-1 alpha-2' })
  @IsISO31661Alpha2()
  country: string;
}

export class EmergencyContactDto {
  @ApiProperty() @IsString() @MaxLength(100) name: string;
  @ApiProperty() @IsString() @MaxLength(50) relationship: string;
  @ApiProperty() @IsString() @MaxLength(30) phone: string;
}

/** Optionally create + invite a login for the new employee in the same call. */
export class InviteLoginDto {
  @ApiProperty({ example: ['EMPLOYEE'] })
  @ArrayNotEmpty()
  @ArrayUnique()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, { each: true })
  roles: string[];
}

export class CreateEmployeeDto {
  @ApiProperty() @IsString() @MaxLength(100) firstName: string;
  @ApiProperty() @IsString() @MaxLength(100) lastName: string;

  @ApiProperty({ example: 'jane.doe@company.com' })
  @IsEmail()
  @MaxLength(254)
  workEmail: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  personalEmail?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
  @ApiPropertyOptional({ example: '1990-05-14' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @ApiPropertyOptional({ type: EmergencyContactDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmergencyContactDto)
  emergencyContact?: EmergencyContactDto;

  @ApiProperty({ example: '2026-10-01' }) @IsDateString() hireDate: string;

  @ApiPropertyOptional({
    enum: EmploymentType,
    default: EmploymentType.FULL_TIME,
  })
  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @ApiPropertyOptional({
    enum: [EmployeeStatus.ONBOARDING, EmployeeStatus.ACTIVE],
    default: EmployeeStatus.ONBOARDING,
    description: 'ACTIVE skips onboarding (e.g. backfilling existing staff)',
  })
  @IsOptional()
  @IsIn([EmployeeStatus.ONBOARDING, EmployeeStatus.ACTIVE])
  status?: EmployeeStatus.ONBOARDING | EmployeeStatus.ACTIVE;

  @ApiProperty({ format: 'uuid' }) @IsUUID() departmentId: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  positionId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  managerId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Link an existing login',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    type: InviteLoginDto,
    description: 'Create + invite a login at workEmail',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InviteLoginDto)
  inviteLogin?: InviteLoginDto;
}

/** Profile fields only. Org placement changes go through /assignments. */
export class UpdateEmployeeDto extends PartialType(
  PickType(CreateEmployeeDto, [
    'firstName',
    'lastName',
    'workEmail',
    'personalEmail',
    'phone',
    'dateOfBirth',
    'address',
    'emergencyContact',
    'employmentType',
  ] as const),
) {
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string | null;
}

/** What an employee may change about themselves. */
export class UpdateSelfDto extends PartialType(
  PickType(CreateEmployeeDto, [
    'personalEmail',
    'phone',
    'address',
    'emergencyContact',
  ] as const),
) {}

export class AssignmentChangeDto {
  @ApiProperty({
    enum: [
      EmploymentChangeType.PROMOTION,
      EmploymentChangeType.TRANSFER,
      EmploymentChangeType.MANAGER_CHANGE,
    ],
  })
  @IsIn([
    EmploymentChangeType.PROMOTION,
    EmploymentChangeType.TRANSFER,
    EmploymentChangeType.MANAGER_CHANGE,
  ])
  changeType:
    | EmploymentChangeType.PROMOTION
    | EmploymentChangeType.TRANSFER
    | EmploymentChangeType.MANAGER_CHANGE;

  @ApiProperty({ example: '2026-11-01' }) @IsDateString() effectiveDate: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  positionId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'null = reports to nobody',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  managerId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ChangeStatusDto {
  @ApiProperty({ enum: [EmployeeStatus.ACTIVE, EmployeeStatus.ON_LEAVE] })
  @IsIn([EmployeeStatus.ACTIVE, EmployeeStatus.ON_LEAVE])
  status: EmployeeStatus.ACTIVE | EmployeeStatus.ON_LEAVE;

  @ApiProperty({ example: '2026-11-01' }) @IsDateString() effectiveDate: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class TerminateEmployeeDto {
  @ApiProperty({ example: '2026-12-31' })
  @IsDateString()
  terminationDate: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'Also suspend the linked login',
  })
  @IsOptional()
  @IsBoolean()
  suspendLogin?: boolean;
}

export class ListEmployeesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  managerId?: string;
  @ApiPropertyOptional({ enum: EmployeeStatus })
  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @ApiPropertyOptional({ description: 'Name, work email or employee number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Include TERMINATED employees',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true') // Type(() => Boolean) would make "false" truthy
  @IsBoolean()
  includeTerminated?: boolean;
}

export class LinkUserDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() userId: string;
}
