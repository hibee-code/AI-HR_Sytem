import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { IndexResult, KnowledgeBaseService } from './knowledge-base.service';

export const AI_JOBS = { INDEX_DOCUMENT: 'index-document' } as const;

interface IndexJobData {
  documentId: string;
}

/** Runs knowledge-base ingestion off the request path; one job per document. */
@Injectable()
@Processor(QUEUES.AI, { autorun: false })
export class AiProcessor extends WorkerHost implements OnModuleInit {
  private readonly enabled: boolean;

  constructor(
    @InjectQueue(QUEUES.AI) private readonly queue: Queue<IndexJobData>,
    private readonly kb: KnowledgeBaseService,
    private readonly logger: Logger,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.enabled = config.get('WORKERS_ENABLED', { infer: true });
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    this.worker.concurrency = 2; // embedding calls are the bottleneck; keep it polite
    void this.worker.run();
  }

  async process(job: Job<IndexJobData>): Promise<IndexResult> {
    if (job.name !== AI_JOBS.INDEX_DOCUMENT)
      throw new Error(`Unknown AI job: ${job.name}`);
    const result = await this.kb.indexDocument(job.data.documentId);
    this.logger.log(result, 'knowledge base job done');
    return result;
  }

  /** Deduplicated by document id: a burst of edits results in one job. */
  async enqueueIndex(documentId: string): Promise<void> {
    await this.queue.add(
      AI_JOBS.INDEX_DOCUMENT,
      { documentId },
      { jobId: `index:${documentId}:${Date.now()}` },
    );
  }

  async enqueueAll(): Promise<number> {
    const ids = await this.kb.eligibleDocumentIds();
    for (const id of ids) await this.enqueueIndex(id);
    return ids.length;
  }
}
