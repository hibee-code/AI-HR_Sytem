import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUES } from './queue.constants';

export const BULL_BOARD_PATH = '/admin/queues';

/**
 * Mounts the Bull Board UI for every registered queue. Development only:
 * it has no authentication of its own, so main.ts never calls this in
 * production.
 */
export function mountBullBoard(app: INestApplication): void {
  const adapter = new ExpressAdapter();
  adapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({
    queues: Object.values(QUEUES).map(
      (name) => new BullMQAdapter(app.get<Queue>(getQueueToken(name))),
    ),
    serverAdapter: adapter,
  });
  app.use(BULL_BOARD_PATH, adapter.getRouter());
}
