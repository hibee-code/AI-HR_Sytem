import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import type { Env } from '../../config/env.schema';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { RetentionService } from './retention.service';

export const PRIVACY_JOBS = { RETENTION: 'retention' } as const;

/** Daily retention run (RETENTION_CRON), one schedule shared by every instance. */
@Injectable()
@Processor(QUEUES.PRIVACY, { autorun: false })
export class RetentionProcessor extends WorkerHost implements OnModuleInit {
  private readonly enabled: boolean;
  private readonly cron: string;

  constructor(
    @InjectQueue(QUEUES.PRIVACY) private readonly queue: Queue,
    private readonly retention: RetentionService,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
    this.cron = config.get('RETENTION_CRON', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    await this.queue.upsertJobScheduler(
      PRIVACY_JOBS.RETENTION,
      { pattern: this.cron },
      { name: PRIVACY_JOBS.RETENTION },
    );
    void this.worker.run();
  }

  async process(job: Job): Promise<Record<string, number>> {
    if (job.name !== PRIVACY_JOBS.RETENTION)
      throw new Error(`Unknown privacy job: ${job.name}`);
    return this.retention.run();
  }
}
