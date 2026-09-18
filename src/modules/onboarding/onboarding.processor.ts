import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { OnboardingService } from './onboarding.service';

export const ONBOARDING_JOBS = {
  DAILY_REMINDERS: 'daily-reminders',
} as const;

type OnboardingJobData = { horizonDays?: number };

/**
 * Scheduled work for checklists. Registers a repeatable "daily reminders"
 * job (cron from REMINDERS_CRON) on startup — upsert, so multiple instances
 * share one schedule — and processes it when WORKERS_ENABLED.
 */
@Injectable()
@Processor(QUEUES.ONBOARDING, { autorun: false })
export class OnboardingProcessor extends WorkerHost implements OnModuleInit {
  private readonly enabled: boolean;
  private readonly cron: string;

  constructor(
    @InjectQueue(QUEUES.ONBOARDING)
    private readonly queue: Queue<OnboardingJobData>,
    private readonly onboarding: OnboardingService,
    private readonly logger: Logger,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
    this.cron = config.get('REMINDERS_CRON', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    await this.queue.upsertJobScheduler(
      ONBOARDING_JOBS.DAILY_REMINDERS,
      { pattern: this.cron },
      { name: ONBOARDING_JOBS.DAILY_REMINDERS, data: { horizonDays: 1 } },
    );
    void this.worker.run();
  }

  async process(job: Job<OnboardingJobData>): Promise<{ digests: number }> {
    switch (job.name) {
      case ONBOARDING_JOBS.DAILY_REMINDERS: {
        const digests = await this.onboarding.sendReminders(
          job.data.horizonDays ?? 1,
        );
        this.logger.log({ digests }, 'onboarding reminders sent');
        return { digests };
      }
      default:
        throw new Error(`Unknown onboarding job: ${job.name}`);
    }
  }

  /** Manual trigger (admin endpoint / tests). */
  runRemindersNow(): Promise<Job<OnboardingJobData>> {
    return this.queue.add(
      ONBOARDING_JOBS.DAILY_REMINDERS,
      { horizonDays: 1 },
      { attempts: 1 },
    );
  }
}
