import type { NotificationChannel } from './entities/notification-log.entity';
import type { TemplateData, TemplateName } from './templates';

/** Who receives a notification. Exactly one addressing mode is used per recipient. */
export interface Recipient {
  /** A login: email comes from the user record, Slack id from preferences. */
  userId?: string;
  /** Direct email address (e.g. an employee with no login yet). */
  email?: string;
  /** Slack channel name/id, e.g. "#hr-notifications". */
  slackChannel?: string;
  /** Display name used for the greeting when no user record exists. */
  name?: string;
}

export interface NotifyOptions<K extends TemplateName = TemplateName> {
  template: K;
  data: TemplateData[K];
  to: Recipient;
  /** Override the template's default channels. */
  channels?: NotificationChannel[];
  /** Makes re-emitted events idempotent: same key → not sent twice. */
  dedupeKey?: string;
}

/** What travels through BullMQ. Small on purpose; the log row holds the rest. */
export interface NotificationJobData {
  logId: string;
  template: TemplateName;
  channel: NotificationChannel;
  to: Recipient;
  data: Record<string, unknown>;
}
