import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { AttendanceService } from './attendance.service';

export const ATTENDANCE_JOBS = { AUTO_CLOSE: 'auto-close' } as const;

/** Hourly: closes sessions left open longer than MAX_SESSION_HOURS. */
@Injectable()
@Processor(QUEUES.ATTENDANCE, { autorun: false })
export class AttendanceProcessor extends WorkerHost implements OnModuleInit {
  private readonly enabled: boolean;

  constructor(
    @InjectQueue(QUEUES.ATTENDANCE) private readonly queue: Queue,
    private readonly attendance: AttendanceService,
    private readonly logger: Logger,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    await this.queue.upsertJobScheduler(
      ATTENDANCE_JOBS.AUTO_CLOSE,
      { pattern: '15 * * * *' },
      { name: ATTENDANCE_JOBS.AUTO_CLOSE },
    );
    void this.worker.run();
  }

  async process(job: Job): Promise<{ closed: number }> {
    if (job.name !== ATTENDANCE_JOBS.AUTO_CLOSE)
      throw new Error(`Unknown attendance job: ${job.name}`);
    const closed = await this.attendance.autoCloseStaleSessions();
    if (closed)
      this.logger.warn({ closed }, 'auto-closed stale attendance sessions');
    return { closed };
  }
}
