import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Shared password policy: 10+ chars, at least one letter and one digit. */
const PASSWORD_RULES = [
  MinLength(10),
  MaxLength(128),
  Matches(/[A-Za-z]/, { message: 'password must contain a letter' }),
  Matches(/\d/, { message: 'password must contain a digit' }),
];

function Password(): PropertyDecorator {
  return (target, key) => {
    IsString()(target, key);
    for (const rule of PASSWORD_RULES) rule(target, key);
  };
}

export class LoginDto {
  @ApiProperty({ example: 'admin@company.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'ChangeMe123!' })
  @IsString()
  @MaxLength(128)
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @MaxLength(256)
  refreshToken: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(256)
  token: string;

  @ApiProperty({ minLength: 10 })
  @Password()
  password: string;
}

export class AcceptInviteDto extends ResetPasswordDto {}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({ minLength: 10 })
  @Password()
  newPassword: string;
}

export class TokenPairResponse {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty({ description: 'Access token lifetime in seconds' })
  expiresIn: number;
  @ApiProperty({ default: 'Bearer' }) tokenType: 'Bearer';
}
