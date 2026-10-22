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

/** Login can stop at a second-factor challenge; check `mfaRequired` first. */
export class LoginResponse {
  @ApiProperty() mfaRequired: boolean;
  @ApiProperty({ required: false, description: 'Present when mfaRequired' })
  mfaToken?: string;
  @ApiProperty({ required: false }) accessToken?: string;
  @ApiProperty({ required: false }) refreshToken?: string;
  @ApiProperty({
    description: 'Seconds until the access token (or MFA challenge) expires',
  })
  expiresIn: number;
  @ApiProperty({ required: false, default: 'Bearer' }) tokenType?: 'Bearer';
}

export class MfaCodeDto {
  @ApiProperty({
    example: '123456',
    description: '6-digit authenticator code, or a recovery code',
  })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code: string;
}

export class MfaVerifyDto extends MfaCodeDto {
  @ApiProperty({ description: 'mfaToken returned by /auth/login' })
  @IsString()
  @MaxLength(1024)
  mfaToken: string;
}

export class MfaSetupResponse {
  @ApiProperty({ description: 'Base32 seed for manual entry' }) secret: string;
  @ApiProperty({ description: 'otpauth:// URI — render as a QR code' })
  otpauthUrl: string;
}

export class MfaEnabledResponse {
  @ApiProperty({
    type: [String],
    description: 'Shown once. Each works a single time if the device is lost.',
  })
  recoveryCodes: string[];
}
