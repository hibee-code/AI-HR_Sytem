import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ApplicationStatus } from '../entities/application.entity';
import { OpeningStatus } from '../entities/job-opening.entity';

export class CreateOpeningDto {
  @ApiProperty({ example: 'Senior Backend Engineer' })
  @IsString()
  @MaxLength(150)
  title: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() departmentId: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  positionId?: string | null;

  @ApiProperty() @IsString() @MaxLength(10000) description: string;

  @ApiProperty({
    type: [String],
    example: [
      '5+ years building backend services',
      'Production experience with PostgreSQL',
    ],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  requirements: string[];
}

export class UpdateOpeningDto extends PartialType(CreateOpeningDto) {
  @ApiPropertyOptional({ enum: OpeningStatus })
  @IsOptional()
  @IsEnum(OpeningStatus)
  status?: OpeningStatus;
}

export class ListOpeningsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OpeningStatus })
  @IsOptional()
  @IsEnum(OpeningStatus)
  status?: OpeningStatus;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

/** Multipart fields accompanying the résumé `file`. */
export class ApplyDto {
  @ApiProperty() @IsString() @MaxLength(100) firstName: string;
  @ApiProperty() @IsString() @MaxLength(100) lastName: string;
  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
  @ApiPropertyOptional({ example: 'careers-page' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  coverLetter?: string;
}

export class UpdateApplicationStatusDto {
  @ApiProperty({ enum: ApplicationStatus })
  @IsEnum(ApplicationStatus)
  status: ApplicationStatus;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ListApplicationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ApplicationStatus })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @ApiPropertyOptional({
    description: 'Only applications with fitScore ≥ this',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @ApiPropertyOptional({ enum: ['fitScore', 'newest'], default: 'fitScore' })
  @IsOptional()
  @IsEnum(['fitScore', 'newest'])
  sort?: 'fitScore' | 'newest';
}
