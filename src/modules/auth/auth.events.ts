/**
 * Domain events emitted by the auth module. The notifications module
 * (stage 3) subscribes to deliver emails; nothing in auth knows about SMTP.
 * Raw tokens are passed here ONLY — they are never persisted.
 */
export const AUTH_EVENTS = {
  USER_INVITED: 'auth.user.invited',
  PASSWORD_RESET_REQUESTED: 'auth.password.reset_requested',
  PASSWORD_CHANGED: 'auth.password.changed',
} as const;

export class UserInvitedEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly firstName: string,
    public readonly inviteToken: string,
    public readonly expiresAt: Date,
  ) {}
}

export class PasswordResetRequestedEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly firstName: string,
    public readonly resetToken: string,
    public readonly expiresAt: Date,
  ) {}
}

export class PasswordChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly firstName: string,
  ) {}
}
