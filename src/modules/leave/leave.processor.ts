import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { LeaveRequestsService } from './leave-requests.service';

export const LEAVE_JOBS = { STATUS_SYNC: 'status-sync' } as const;

/** Daily: ON_LEAVE ↔ ACTIVE flips for long approved leave. Runs shortly after midnight UTC. */
@Injectable()
@Processor(QUEUES.LEAVE, { autorun: false })
export class LeaveProcessor extends WorkerHost implements OnModuleInit {
  private readonly enabled: boolean;

  constructor(
    @InjectQueue(QUEUES.LEAVE) private readonly queue: Queue,
    private readonly requests: LeaveRequestsService,
    private readonly logger: Logger,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    await this.queue.upsertJobScheduler(
      LEAVE_JOBS.STATUS_SYNC,
      { pattern: '5 0 * * *' },
      { name: LEAVE_JOBS.STATUS_SYNC },
    );
    void this.worker.run();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== LEAVE_JOBS.STATUS_SYNC)
      throw new Error(`Unknown leave job: ${job.name}`);
    const result = await this.requests.syncEmployeeStatuses();
    this.logger.log(result, 'leave status sync');
    return result;
  }

  runSyncNow(): Promise<Job> {
    return this.queue.add(LEAVE_JOBS.STATUS_SYNC, {}, { attempts: 1 });
  }
}
