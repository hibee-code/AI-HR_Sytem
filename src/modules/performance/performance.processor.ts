import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { ReviewsService } from './reviews.service';

export const PERFORMANCE_JOBS = { REMINDERS: 'review-reminders' } as const;

/** Daily 08:30 UTC: nudges self-reviews and manager reviews near or past their deadline. */
@Injectable()
@Processor(QUEUES.PERFORMANCE, { autorun: false })
export class PerformanceProcessor extends WorkerHost implements OnModuleInit {
  private readonly enabled: boolean;

  constructor(
    @InjectQueue(QUEUES.PERFORMANCE) private readonly queue: Queue,
    private readonly reviews: ReviewsService,
    private readonly logger: Logger,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    await this.queue.upsertJobScheduler(
      PERFORMANCE_JOBS.REMINDERS,
      { pattern: '30 8 * * *' },
      { name: PERFORMANCE_JOBS.REMINDERS },
    );
    void this.worker.run();
  }

  async process(job: Job): Promise<{ sent: number }> {
    if (job.name !== PERFORMANCE_JOBS.REMINDERS)
      throw new Error(`Unknown performance job: ${job.name}`);
    const sent = await this.reviews.sendReminders();
    this.logger.log({ sent }, 'review reminders sent');
    return { sent };
  }

  runRemindersNow(): Promise<Job> {
    return this.queue.add(PERFORMANCE_JOBS.REMINDERS, {}, { attempts: 1 });
  }
}
