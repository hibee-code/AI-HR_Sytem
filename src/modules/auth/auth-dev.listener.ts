import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';
import {
  AUTH_EVENTS,
  PasswordResetRequestedEvent,
  UserInvitedEvent,
} from './auth.events';

/**
 * Development convenience: prints invite / reset links to the log so the
 * flows can be exercised before the notifications module (stage 3) delivers
 * them by email. Does nothing in production — tokens never reach logs there.
 */
@Injectable()
export class AuthDevListener {
  private readonly enabled: boolean;
  private readonly appUrl: string;

  constructor(
    private readonly logger: Logger,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('NODE_ENV', { infer: true }) !== 'production';
    this.appUrl = config.get('APP_URL', { infer: true });
  }

  @OnEvent(AUTH_EVENTS.USER_INVITED)
  onInvited(e: UserInvitedEvent): void {
    if (!this.enabled) return;
    this.logger.warn(
      { userId: e.userId, email: e.email, expiresAt: e.expiresAt },
      `[DEV] invite token for ${e.email}: ${e.inviteToken}  → ${this.appUrl}/accept-invite?token=${e.inviteToken}`,
    );
  }

  @OnEvent(AUTH_EVENTS.PASSWORD_RESET_REQUESTED)
  onResetRequested(e: PasswordResetRequestedEvent): void {
    if (!this.enabled) return;
    this.logger.warn(
      { userId: e.userId, email: e.email, expiresAt: e.expiresAt },
      `[DEV] password reset token for ${e.email}: ${e.resetToken}`,
    );
  }
}
