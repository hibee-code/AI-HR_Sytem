import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import type { RedisOptions } from 'ioredis';
import { REDIS_OPTIONS } from '../redis/redis.constants';

/**
 * BullMQ root. Feature modules register their own queues with
 * `BullModule.registerQueue({ name: QUEUES.X })` and workers with @Processor.
 * Connections derive from the same validated Redis options as the cache client.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [REDIS_OPTIONS],
      useFactory: (redis: RedisOptions) => ({
        // BullMQ 6 ships its own structural RedisOptions type; pass the fields it knows.
        connection: {
          host: redis.host,
          port: redis.port,
          password: redis.password,
          db: redis.db,
          maxRetriesPerRequest: null, // required by BullMQ for blocking commands
        },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { count: 1_000, age: 24 * 3600 },
          removeOnFail: { count: 5_000 },
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
