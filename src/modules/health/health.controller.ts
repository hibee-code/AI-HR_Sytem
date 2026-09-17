import { Controller, Get, Inject } from '@nestjs/common';
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
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
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

  private async redisCheck(key: string): Promise<HealthIndicatorResult> {
    const check = this.indicator.check(key);
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG'
        ? check.up()
        : check.down({ message: `unexpected reply: ${String(pong)}` });
    } catch (err) {
      return check.down({ message: (err as Error).message });
    }
  }
}
