import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { instanceToPlain } from 'class-transformer';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { Client } from '../../common/decorators/client-info.decorator';
import type { ClientInfo } from '../../common/decorators/client-info.decorator';
import { AllowWithoutMfa } from '../../common/decorators/allow-without-mfa.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { InviteUserDto } from '../users/dto/user.dto';
import { AuthService, LoginResult } from './auth.service';
import {
  AcceptInviteDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LoginResponse,
  MfaCodeDto,
  MfaEnabledResponse,
  MfaSetupResponse,
  MfaVerifyDto,
  RefreshTokenDto,
  ResetPasswordDto,
  TokenPairResponse,
} from './dto/auth.dto';
import { MfaService } from './mfa.service';
import type { IssuedTokens } from './token.service';
import { Audit } from '../audit/audit.decorator';

/** Tighter limit for credential-guessing surfaces: 5 attempts / minute / IP. */
const STRICT = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
  ) {}

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Email + password → token pair, or an MFA challenge (mfaRequired: true)',
  })
  @ApiOkResponse({ type: LoginResponse })
  async login(@Body() dto: LoginDto, @Client() client: ClientInfo) {
    return toLoginResponse(
      await this.auth.login(dto.email, dto.password, client),
    );
  }

  // ── MFA ──────────────────────────────────────────────────────────────

  @Public()
  @Throttle(STRICT)
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finish an MFA login with a TOTP or recovery code',
  })
  @ApiOkResponse({ type: LoginResponse })
  async verifyMfa(@Body() dto: MfaVerifyDto, @Client() client: ClientInfo) {
    return toLoginResponse(
      await this.auth.verifyMfa(dto.mfaToken, dto.code, client),
    );
  }

  @ApiBearerAuth('access-token')
  @AllowWithoutMfa()
  @Post('mfa/setup')
  @ApiOperation({
    summary: 'Start TOTP enrolment: returns a seed + otpauth URI for a QR code',
  })
  @ApiOkResponse({ type: MfaSetupResponse })
  mfaSetup(@CurrentUser('id') userId: string) {
    return this.mfa.beginSetup(userId);
  }

  @ApiBearerAuth('access-token')
  @AllowWithoutMfa()
  @Audit('auth.mfa.enable', 'user')
  @Post('mfa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm enrolment with a code; returns one-time recovery codes',
  })
  @ApiOkResponse({ type: MfaEnabledResponse })
  mfaEnable(@CurrentUser('id') userId: string, @Body() dto: MfaCodeDto) {
    return this.mfa.enable(userId, dto.code);
  }

  @ApiBearerAuth('access-token')
  @Audit('auth.mfa.recovery_codes', 'user')
  @Post('mfa/recovery-codes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Replace all recovery codes (needs a current authenticator code); returns the new set once',
  })
  @ApiOkResponse({ type: MfaEnabledResponse })
  regenerateRecoveryCodes(
    @CurrentUser('id') userId: string,
    @Body() dto: MfaCodeDto,
  ) {
    return this.mfa.regenerateRecoveryCodes(userId, dto.code);
  }

  @ApiBearerAuth('access-token')
  @Audit('auth.mfa.disable', 'user')
  @Post('mfa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Turn MFA off (not allowed for roles where it is mandatory)',
  })
  mfaDisable(@CurrentUser('id') userId: string, @Body() dto: MfaCodeDto) {
    return this.mfa.disable(userId, dto.code);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token; the old one is invalidated',
  })
  @ApiOkResponse({ type: TokenPairResponse })
  async refresh(@Body() dto: RefreshTokenDto, @Client() client: ClientInfo) {
    return toResponse(await this.auth.refresh(dto.refreshToken, client));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke this device’s refresh token (idempotent)' })
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth('access-token')
  @AllowWithoutMfa()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke every refresh token for the current user' })
  logoutAll(@CurrentUser('id') userId: string) {
    return this.auth.logoutAll(userId);
  }

  @ApiBearerAuth('access-token')
  @AllowWithoutMfa()
  @Get('me')
  @ApiOperation({
    summary:
      'Current user: roles, effective permissions and MFA state (mfaSetupRequired → send them to setup)',
  })
  async me(@CurrentUser() user: AuthUser) {
    const profile = await this.auth.me(user);
    return {
      ...instanceToPlain(profile),
      permissions: user.permissions,
      mfaSetupRequired: !user.mfaEnabled && this.mfa.isRequiredFor(user.roles),
      // Prompt to regenerate before they run out (0 + lost phone = admin reset).
      mfaRecoveryCodesRemaining: profile.mfaEnabled
        ? profile.mfaRecoveryCodes.length
        : null,
    };
  }

  // ── Invite ───────────────────────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @RequirePermissions(PERMISSIONS.USER_INVITE)
  @Audit('user.invite', 'user', { bodyKeys: ['roles'] })
  @Post('invite')
  @ApiOperation({ summary: 'Create a user and send them an invite link' })
  invite(@Body() dto: InviteUserDto) {
    return this.auth.invite(dto);
  }

  @ApiBearerAuth('access-token')
  @RequirePermissions(PERMISSIONS.USER_INVITE)
  @Audit('user.invite.resend', 'user', { idParam: 'userId' })
  @Post('invite/:userId/resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  resendInvite(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.auth.resendInvite(userId);
  }

  @Public()
  @Throttle(STRICT)
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set a password with an invite token; returns a session',
  })
  @ApiOkResponse({ type: TokenPairResponse })
  async acceptInvite(
    @Body() dto: AcceptInviteDto,
    @Client() client: ClientInfo,
  ) {
    return toResponse(
      await this.auth.acceptInvite(dto.token, dto.password, client),
    );
  }

  // ── Password ─────────────────────────────────────────────────────────

  @Public()
  @Throttle(STRICT)
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request a reset link (always 202, even for unknown emails)',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Throttle(STRICT)
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set a new password with a reset token; all sessions are revoked',
  })
  resetPassword(@Body() dto: ResetPasswordDto, @Client() client: ClientInfo) {
    return this.auth.resetPassword(dto.token, dto.password, dto.code, client);
  }

  @ApiBearerAuth('access-token')
  @AllowWithoutMfa()
  @Audit('auth.password.change', 'user')
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Change own password; every session is revoked, log in again',
  })
  changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}

function toResponse(t: IssuedTokens): TokenPairResponse {
  return { ...t, tokenType: 'Bearer' };
}

function toLoginResponse(r: LoginResult): LoginResponse {
  return r.mfaRequired ? r : { ...r, tokenType: 'Bearer' };
}
