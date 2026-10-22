import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  HealthIndicatorService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants';

@ApiTags('health')
@Public()
@SkipThrottle()
// Outside the /api prefix (see app.setup.ts) and unversioned: probes live at /health/*.
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly indicator: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Liveness: process is up. Never touches dependencies. */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return { status: 'ok' };
  }

  /** Readiness: DB and Redis reachable. Use for load-balancer / k8s readiness. */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (Postgres + Redis)' })
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.db.pingCheck('postgres', { timeout: 3000 }),
      () => this.redisCheck('redis'),
    ]);
  }

  /**
   * Reachable, and not close to `maxmemory`: with `noeviction` a full Redis
   * rejects writes and every queue stalls, so warn at 90%.
   */
  private async redisCheck(key: string): Promise<HealthIndicatorResult> {
    const check = this.indicator.check(key);
    try {
      const pong = await this.redis.ping();
      if (pong !== 'PONG')
        return check.down({ message: `unexpected reply: ${String(pong)}` });
      const memory = redisMemory(await this.redis.info('memory'));
      if (memory.max > 0 && memory.used / memory.max > REDIS_MEMORY_LIMIT)
        return check.down({
          message: 'memory above 90% of maxmemory',
          ...memory,
        });
      return check.up(memory);
    } catch (err) {
      return check.down({ message: (err as Error).message });
    }
  }
}

const REDIS_MEMORY_LIMIT = 0.9;

/** used / maxmemory in bytes from `INFO memory` (max 0 = no limit set). */
export function redisMemory(info: string): { used: number; max: number } {
  const field = (name: string) =>
    Number(new RegExp(`^${name}:(\\d+)`, 'm').exec(info)?.[1] ?? 0);
  return { used: field('used_memory'), max: field('maxmemory') };
}
