import { Injectable, Inject } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Redis-backed ThrottlerStorage so rate limits are shared across app instances.
 * Mirrors the semantics of @nestjs/throttler's in-memory ThrottlerStorageService:
 * fixed window of `ttl` ms; once hits exceed `limit`, the key is blocked for
 * `blockDuration` ms. Everything runs in one Lua script for atomicity.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private static readonly SCRIPT = `
    local hitKey   = KEYS[1]
    local blockKey = KEYS[2]
    local ttl      = tonumber(ARGV[1])
    local limit    = tonumber(ARGV[2])
    local blockTtl = tonumber(ARGV[3])

    local blockTtlLeft = redis.call('PTTL', blockKey)
    if blockTtlLeft > 0 then
      local hits = tonumber(redis.call('GET', hitKey) or '0')
      return { hits, redis.call('PTTL', hitKey), 1, blockTtlLeft }
    end

    local hits = redis.call('INCR', hitKey)
    if hits == 1 then
      redis.call('PEXPIRE', hitKey, ttl)
    end
    local ttlLeft = redis.call('PTTL', hitKey)
    if ttlLeft < 0 then
      redis.call('PEXPIRE', hitKey, ttl)
      ttlLeft = ttl
    end

    if hits > limit then
      redis.call('SET', blockKey, '1', 'PX', blockTtl)
      return { hits, ttlLeft, 1, blockTtl }
    end
    return { hits, ttlLeft, 0, 0 }
  `;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:${throttlerName}:${key}:hits`;
    const blockKey = `throttle:${throttlerName}:${key}:block`;

    const [totalHits, ttlMs, blocked, blockMs] = (await this.redis.eval(
      RedisThrottlerStorage.SCRIPT,
      2,
      hitKey,
      blockKey,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];

    return {
      totalHits,
      timeToExpire: Math.ceil(ttlMs / 1000),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.ceil(blockMs / 1000),
    };
  }
}
