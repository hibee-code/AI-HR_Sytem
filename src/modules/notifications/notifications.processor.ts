import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import type { Env } from '../../config/env.schema';
import { MailService } from '../../infrastructure/mail/mail.service';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { SlackService } from '../../infrastructure/slack/slack.service';
import { UsersService } from '../users/users.service';
import {
  NotificationChannel,
  NotificationLog,
  NotificationStatus,
} from './entities/notification-log.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import type { NotificationJobData } from './notifications.types';
import { TEMPLATES, TemplateContext } from './templates';

/** Thrown to mark a job as deliberately not delivered; never retried. */
class SkipNotification extends Error {}

/**
 * Delivers queued notifications. Started only when WORKERS_ENABLED=true so
 * API-only instances can share the queue without consuming it.
 */
@Injectable()
@Processor(QUEUES.NOTIFICATIONS, { autorun: false })
export class NotificationsProcessor extends WorkerHost implements OnModuleInit {
  private readonly ctx: TemplateContext;
  private readonly enabled: boolean;
  private readonly concurrency: number;

  constructor(
    config: ConfigService<Env, true>,
    @InjectRepository(NotificationLog)
    private readonly logs: Repository<NotificationLog>,
    @InjectRepository(NotificationPreference)
    private readonly preferences: Repository<NotificationPreference>,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly slack: SlackService,
    private readonly logger: Logger,
  ) {
    super();
    this.ctx = {
      appName: config.get('APP_NAME', { infer: true }),
      appUrl: config.get('APP_URL', { infer: true }),
    };
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
    this.concurrency = config.get('NOTIFICATIONS_CONCURRENCY', { infer: true });
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn(
        'WORKERS_ENABLED=false: notifications will queue but not send from this instance',
      );
      return;
    }
    this.worker.concurrency = this.concurrency;
    void this.worker.run();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const { logId, template, channel, to, data } = job.data;
    const log = await this.logs.findOne({ where: { id: logId } });
    if (!log) throw new SkipNotification(`log ${logId} missing`);
    if (
      log.status === NotificationStatus.SENT ||
      log.status === NotificationStatus.SKIPPED
    )
      return;

    try {
      const providerRef =
        channel === NotificationChannel.EMAIL
          ? await this.deliverEmail(log, template, to, data)
          : await this.deliverSlack(log, template, to, data);

      await this.logs.update(logId, {
        status: NotificationStatus.SENT,
        providerRef,
        sentAt: new Date(),
        attempts: job.attemptsMade + 1,
        error: null,
      });
    } catch (err) {
      if (err instanceof SkipNotification) {
        await this.logs.update(logId, {
          status: NotificationStatus.SKIPPED,
          error: err.message,
          attempts: job.attemptsMade + 1,
        });
        return;
      }
      const message = (err as Error).message?.slice(0, 1000) ?? 'unknown error';
      const exhausted = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.logs.update(logId, {
        status: exhausted
          ? NotificationStatus.FAILED
          : NotificationStatus.QUEUED,
        error: message,
        attempts: job.attemptsMade + 1,
      });
      throw err; // let BullMQ retry with backoff
    }
  }

  private async deliverEmail(
    log: NotificationLog,
    template: NotificationJobData['template'],
    to: NotificationJobData['to'],
    data: Record<string, unknown>,
  ): Promise<string> {
    const render = TEMPLATES[template].email;
    if (!render)
      throw new SkipNotification(`template ${template} has no email variant`);

    let address = to.email ?? null;
    if (to.userId) {
      const prefs = await this.preferences.findOne({
        where: { userId: to.userId },
      });
      if (prefs && !prefs.emailEnabled)
        throw new SkipNotification('email disabled by user');
      address ??= (await this.users.findById(to.userId)).email;
    }
    if (!address) throw new SkipNotification('no email address for recipient');

    const rendered = render(data as never, this.ctx);
    const { messageId } = await this.mail.send({ to: address, ...rendered });
    await this.logs.update(log.id, { recipientAddress: address });
    return messageId;
  }

  private async deliverSlack(
    log: NotificationLog,
    template: NotificationJobData['template'],
    to: NotificationJobData['to'],
    data: Record<string, unknown>,
  ): Promise<string> {
    const render = TEMPLATES[template].slack;
    if (!render)
      throw new SkipNotification(`template ${template} has no slack variant`);
    if (!this.slack.isConfigured)
      throw new SkipNotification('slack not configured');

    const channel =
      to.slackChannel ??
      (to.userId ? await this.resolveSlackUser(to.userId) : null);
    if (!channel)
      throw new SkipNotification('no slack destination for recipient');

    const { ts } = await this.slack.post({
      channel,
      ...render(data as never, this.ctx),
    });
    await this.logs.update(log.id, { recipientAddress: channel });
    return ts;
  }

  /** Slack id from preferences, else looked up by email and cached. */
  private async resolveSlackUser(userId: string): Promise<string | null> {
    let prefs = await this.preferences.findOne({ where: { userId } });
    if (prefs && !prefs.slackEnabled)
      throw new SkipNotification('slack disabled by user');
    if (prefs?.slackUserId) return prefs.slackUserId;

    const user = await this.users.findById(userId);
    const slackUserId = await this.slack.lookupUserIdByEmail(user.email);
    if (!slackUserId) return null;

    prefs ??= this.preferences.create({
      userId,
      emailEnabled: true,
      slackEnabled: true,
    });
    prefs.slackUserId = slackUserId;
    await this.preferences.save(prefs);
    return slackUserId;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<NotificationJobData> | undefined, err: Error): void {
    this.logger.warn(
      { jobId: job?.id, attempt: job?.attemptsMade, err: err.message },
      'notification delivery failed',
    );
  }
}
