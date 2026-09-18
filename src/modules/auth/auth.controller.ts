import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Headers,
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { InviteUserDto } from '../users/dto/user.dto';
import { AuthService } from './auth.service';
import {
  AcceptInviteDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  ResetPasswordDto,
  TokenPairResponse,
} from './dto/auth.dto';
import type { ClientMeta, IssuedTokens } from './token.service';

/** Tighter limit for credential-guessing surfaces: 5 attempts / minute / IP. */
const STRICT = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange email + password for an access/refresh token pair',
  })
  @ApiOkResponse({ type: TokenPairResponse })
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ) {
    return toResponse(
      await this.auth.login(dto.email, dto.password, meta(ip, ua)),
    );
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token; the old one is invalidated',
  })
  @ApiOkResponse({ type: TokenPairResponse })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ) {
    return toResponse(await this.auth.refresh(dto.refreshToken, meta(ip, ua)));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke this device’s refresh token (idempotent)' })
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth('access-token')
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke every refresh token for the current user' })
  logoutAll(@CurrentUser('id') userId: string) {
    return this.auth.logoutAll(userId);
  }

  @ApiBearerAuth('access-token')
  @Get('me')
  @ApiOperation({
    summary: 'Current user profile with roles and effective permissions',
  })
  async me(@CurrentUser() user: AuthUser) {
    const profile = await this.auth.me(user);
    return { ...instanceToPlain(profile), permissions: user.permissions };
  }

  // ── Invite ───────────────────────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @RequirePermissions(PERMISSIONS.USER_INVITE)
  @Post('invite')
  @ApiOperation({ summary: 'Create a user and send them an invite link' })
  invite(@Body() dto: InviteUserDto) {
    return this.auth.invite(dto);
  }

  @ApiBearerAuth('access-token')
  @RequirePermissions(PERMISSIONS.USER_INVITE)
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
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ) {
    return toResponse(
      await this.auth.acceptInvite(dto.token, dto.password, meta(ip, ua)),
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
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @ApiBearerAuth('access-token')
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

function meta(ip: string, ua?: string): ClientMeta {
  return { ipAddress: ip, userAgent: ua };
}

function toResponse(t: IssuedTokens): TokenPairResponse {
  return { ...t, tokenType: 'Bearer' };
}
