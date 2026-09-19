import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { QUEUES } from './infrastructure/queue/queue.constants';
import { REDIS_CLIENT } from './infrastructure/redis/redis.constants';
import { NotificationsProcessor } from './modules/notifications/notifications.processor';
import { OnboardingProcessor } from './modules/onboarding/onboarding.processor';
import { LeaveProcessor } from './modules/leave/leave.processor';
import { AttendanceProcessor } from './modules/attendance/attendance.processor';
import { PerformanceProcessor } from './modules/performance/performance.processor';

/**
 * Boots the whole application graph with the database and Redis replaced by
 * stubs. Catches DI mistakes (missing providers, unexported services,
 * circular module imports) and verifies the global guard chain without
 * needing docker. Real behaviour is covered by the e2e suite.
 */
describe('AppModule wiring', () => {
  let app: INestApplication;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DB_HOST: 'stub',
      DB_USERNAME: 'stub',
      DB_PASSWORD: 'stub',
      DB_NAME: 'stub',
      REDIS_HOST: 'stub',
      WORKERS_ENABLED: 'false',
      STORAGE_DRIVER: 'memory',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
    });

    const fakeRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const fakeDataSource = {
      isInitialized: true,
      options: { type: 'postgres' },
      entityMetadatas: [],
      getRepository: () => fakeRepo,
      query: jest.fn(async () => [{ '?column?': 1 }]),
      destroy: jest.fn(),
      manager: {},
    };
    const fakeQueue = () => ({
      add: jest.fn(),
      close: jest.fn(),
      upsertJobScheduler: jest.fn(),
    });
    const fakeRedis = {
      get: jest.fn(async () => null),
      set: jest.fn(),
      del: jest.fn(),
      ping: jest.fn(async () => 'PONG'),
      eval: jest.fn(async () => [1, 60_000, 0, 0]),
      quit: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDataSourceToken())
      .useValue(fakeDataSource)
      .overrideProvider(REDIS_CLIENT)
      .useValue(fakeRedis)
      // BullMQ opens blocking Redis connections; the e2e suite covers real delivery.
      .overrideProvider(getQueueToken(QUEUES.NOTIFICATIONS))
      .useValue({ add: jest.fn(), close: jest.fn() })
      .overrideProvider(NotificationsProcessor)
      .useValue({})
      .overrideProvider(getQueueToken(QUEUES.ONBOARDING))
      .useValue({
        add: jest.fn(),
        close: jest.fn(),
        upsertJobScheduler: jest.fn(),
      })
      .overrideProvider(OnboardingProcessor)
      .useValue({})
      .overrideProvider(getQueueToken(QUEUES.LEAVE))
      .useValue(fakeQueue())
      .overrideProvider(LeaveProcessor)
      .useValue({})
      .overrideProvider(getQueueToken(QUEUES.ATTENDANCE))
      .useValue(fakeQueue())
      .overrideProvider(AttendanceProcessor)
      .useValue({})
      .overrideProvider(getQueueToken(QUEUES.PERFORMANCE))
      .useValue(fakeQueue())
      .overrideProvider(PerformanceProcessor)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots every module', () => {
    expect(app).toBeDefined();
  });

  it('public routes are reachable without a token', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
  });

  it('protected routes reject anonymous callers with 401 (JwtAuthGuard is global)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users')
      .expect(401);
    expect(res.body).toMatchObject({ statusCode: 401, error: 'Unauthorized' });
    expect(res.headers['x-correlation-id']).toBeDefined();
  });

  it('routes live under the versioned prefix; unversioned paths 404', async () => {
    await request(app.getHttpServer()).get('/users').expect(404);
  });

  it('validation pipe rejects unknown / malformed bodies with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: 'x', extra: true })
      .expect(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining('email'),
        expect.stringContaining('extra'),
      ]),
    );
  });
});
