import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import {
  PaginatedResponse,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import {
  JsonPayload,
  NotificationChannel,
  NotificationLog,
  NotificationStatus,
} from './entities/notification-log.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import type { NotificationJobData, NotifyOptions } from './notifications.types';
import { TEMPLATES, TemplateName } from './templates';

export interface LogFilter extends PaginationQueryDto {
  status?: NotificationStatus;
  channel?: NotificationChannel;
  recipientUserId?: string;
  template?: string;
}

/**
 * Façade every other module uses: `notify()` records intent in
 * notification_log and enqueues one BullMQ job per channel. Delivery
 * happens in NotificationsProcessor.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectQueue(QUEUES.NOTIFICATIONS)
    private readonly queue: Queue<NotificationJobData>,
    @InjectRepository(NotificationLog)
    private readonly logs: Repository<NotificationLog>,
    @InjectRepository(NotificationPreference)
    private readonly preferences: Repository<NotificationPreference>,
    private readonly logger: Logger,
  ) {}

  /** Returns the log ids created (empty when deduplicated away). */
  async notify<K extends TemplateName>(
    opts: NotifyOptions<K>,
  ): Promise<string[]> {
    const template = TEMPLATES[opts.template];
    const channels = opts.channels ?? template.defaultChannels;
    const ids: string[] = [];

    for (const channel of channels) {
      if (channel === NotificationChannel.EMAIL && !template.email) continue;
      if (channel === NotificationChannel.SLACK && !template.slack) continue;

      const dedupeKey = opts.dedupeKey ? `${opts.dedupeKey}:${channel}` : null;
      const result = await this.logs
        .createQueryBuilder()
        .insert()
        .into(NotificationLog)
        .values({
          channel,
          template: opts.template,
          recipientUserId: opts.to.userId ?? null,
          recipientAddress: opts.to.email ?? opts.to.slackChannel ?? null,
          status: NotificationStatus.QUEUED,
          dedupeKey,
          payload: redact(opts.data as Record<string, unknown>),
        })
        .orIgnore() // unique dedupe_key → silently skip repeats
        .returning('id')
        .execute();

      const logId = (result.raw as { id: string }[])[0]?.id;
      if (!logId) {
        this.logger.debug({ dedupeKey }, 'notification deduplicated');
        continue;
      }

      const job = await this.queue.add(
        `${opts.template}:${channel}`,
        {
          logId,
          template: opts.template,
          channel,
          to: opts.to,
          data: opts.data as Record<string, unknown>,
        },
        { jobId: logId },
      );
      await this.logs.update(logId, { jobId: job.id ?? null });
      ids.push(logId);
    }
    return ids;
  }

  // ── Preferences ───────────────────────────────────────────────────────

  async getPreferences(userId: string): Promise<NotificationPreference> {
    return (
      (await this.preferences.findOne({ where: { userId } })) ??
      this.preferences.create({
        userId,
        emailEnabled: true,
        slackEnabled: true,
        slackUserId: null,
      })
    );
  }

  async updatePreferences(
    userId: string,
    patch: Partial<
      Pick<
        NotificationPreference,
        'emailEnabled' | 'slackEnabled' | 'slackUserId'
      >
    >,
  ): Promise<NotificationPreference> {
    const prefs = await this.getPreferences(userId);
    Object.assign(prefs, patch);
    return this.preferences.save(prefs);
  }

  // ── Log ───────────────────────────────────────────────────────────────

  async listLog(
    filter: LogFilter,
  ): Promise<PaginatedResponse<NotificationLog>> {
    const qb = this.logs
      .createQueryBuilder('n')
      .orderBy('n.createdAt', 'DESC')
      .skip(filter.skip)
      .take(filter.limit);
    if (filter.status)
      qb.andWhere('n.status = :status', { status: filter.status });
    if (filter.channel)
      qb.andWhere('n.channel = :channel', { channel: filter.channel });
    if (filter.template)
      qb.andWhere('n.template = :template', { template: filter.template });
    if (filter.recipientUserId) {
      qb.andWhere('n.recipientUserId = :uid', { uid: filter.recipientUserId });
    }
    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResponse(data, total, filter);
  }
}

/** Log payloads never carry links or tokens; those live only in the short-lived job. */
function redact(data: Record<string, unknown>): JsonPayload {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k,
      /(token|url)$/i.test(k)
        ? '[redacted]'
        : (v as string | number | boolean | null),
    ]),
  );
}
