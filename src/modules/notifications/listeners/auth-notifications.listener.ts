import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import type { Env } from '../../../config/env.schema';
import {
  AUTH_EVENTS,
  PasswordChangedEvent,
  PasswordResetRequestedEvent,
  UserInvitedEvent,
} from '../../auth/auth.events';
import { NotificationsService } from '../notifications.service';

/**
 * Auth events → emails. Raw tokens go straight into the rendered link and
 * are never stored (the log's payload keeps only the URL-free fields).
 */
@Injectable()
export class AuthNotificationsListener {
  private readonly appUrl: string;

  constructor(
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true });
  }

  @OnEvent(AUTH_EVENTS.USER_INVITED, { async: true, promisify: true })
  async onInvited(e: UserInvitedEvent): Promise<void> {
    await this.notifications.notify({
      template: 'USER_INVITED',
      to: { email: e.email, name: e.firstName },
      data: {
        firstName: e.firstName,
        inviteUrl: `${this.appUrl}/accept-invite?token=${encodeURIComponent(e.inviteToken)}`,
        expiresAt: e.expiresAt.toISOString(),
      },
      dedupeKey: `auth.invite:${e.userId}:${e.expiresAt.getTime()}`,
    });
  }

  @OnEvent(AUTH_EVENTS.PASSWORD_RESET_REQUESTED, {
    async: true,
    promisify: true,
  })
  async onResetRequested(e: PasswordResetRequestedEvent): Promise<void> {
    await this.notifications.notify({
      template: 'PASSWORD_RESET',
      to: { email: e.email, name: e.firstName },
      data: {
        firstName: e.firstName,
        resetUrl: `${this.appUrl}/reset-password?token=${encodeURIComponent(e.resetToken)}`,
        expiresAt: e.expiresAt.toISOString(),
      },
      dedupeKey: `auth.reset:${e.userId}:${e.expiresAt.getTime()}`,
    });
  }

  @OnEvent(AUTH_EVENTS.PASSWORD_CHANGED, { async: true, promisify: true })
  async onPasswordChanged(e: PasswordChangedEvent): Promise<void> {
    await this.notifications.notify({
      template: 'PASSWORD_CHANGED',
      // Bypass preferences: security notices always go out.
      to: { email: e.email },
      data: { firstName: e.firstName },
    });
  }
}
