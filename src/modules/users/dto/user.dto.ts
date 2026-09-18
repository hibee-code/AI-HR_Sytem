import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { UserStatus } from '../entities/user.entity';

export class InviteUserDto {
  @ApiProperty({ example: 'jane@company.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: ['EMPLOYEE'], description: 'Role names' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, { each: true })
  roles: string[];
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;
}

export class SetUserRolesDto {
  @ApiProperty({ example: ['EMPLOYEE', 'MANAGER'] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, { each: true })
  roles: string[];
}

export class SetUserStatusDto {
  @ApiProperty({ enum: [UserStatus.ACTIVE, UserStatus.SUSPENDED] })
  @IsEnum([UserStatus.ACTIVE, UserStatus.SUSPENDED])
  status: UserStatus.ACTIVE | UserStatus.SUSPENDED;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Case-insensitive match on email or name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
