import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { RecruitingService } from './recruiting.service';

export const RECRUITING_JOBS = { SCREEN: 'screen-application' } as const;

interface ScreenJobData {
  applicationId: string;
}

/** Runs résumé screening off the request path; 3 attempts with backoff (LLM/embedding hiccups). */
@Injectable()
@Processor(QUEUES.RECRUITING, { autorun: false })
export class RecruitingProcessor extends WorkerHost implements OnModuleInit {
  private readonly enabled: boolean;

  constructor(
    @InjectQueue(QUEUES.RECRUITING)
    private readonly queue: Queue<ScreenJobData>,
    private readonly recruiting: RecruitingService,
    private readonly logger: Logger,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    this.worker.concurrency = 2;
    void this.worker.run();
  }

  async process(job: Job<ScreenJobData>): Promise<{ fitScore: number | null }> {
    if (job.name !== RECRUITING_JOBS.SCREEN)
      throw new Error(`Unknown recruiting job: ${job.name}`);
    const app = await this.recruiting.screen(job.data.applicationId);
    this.logger.log(
      { applicationId: app.id, fitScore: app.fitScore },
      'application screened',
    );
    return { fitScore: app.fitScore };
  }

  enqueueScreen(applicationId: string): Promise<Job<ScreenJobData>> {
    return this.queue.add(
      RECRUITING_JOBS.SCREEN,
      { applicationId },
      { jobId: `screen:${applicationId}:${Date.now()}`, attempts: 3 },
    );
  }
}
