import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import {
  NotificationChannel,
  NotificationLog,
} from './entities/notification-log.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationsService } from './notifications.service';

describe('NotificationsService.notify', () => {
  let service: NotificationsService;
  let queue: { add: jest.Mock };
  let execute: jest.Mock;
  let values: jest.Mock;
  let logs: { createQueryBuilder: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    let n = 0;
    execute = jest.fn(async () => ({ raw: [{ id: `log-${++n}` }] }));
    values = jest.fn();
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['insert', 'into', 'orIgnore', 'returning'])
      qb[m] = jest.fn(() => qb);
    qb.values = values.mockImplementation(() => qb);
    qb.execute = execute;
    logs = { createQueryBuilder: jest.fn(() => qb), update: jest.fn() };
    queue = { add: jest.fn(async (_name, data) => ({ id: data.logId })) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getQueueToken(QUEUES.NOTIFICATIONS), useValue: queue },
        { provide: getRepositoryToken(NotificationLog), useValue: logs },
        { provide: getRepositoryToken(NotificationPreference), useValue: {} },
        { provide: Logger, useValue: { debug: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('enqueues one job per default channel with the log id as jobId', async () => {
    const ids = await service.notify({
      template: 'NEW_HIRE_FOR_MANAGER',
      to: { userId: 'u1' },
      data: {
        managerFirstName: 'B',
        employeeName: 'J',
        startDate: 'd',
        department: 'E',
        position: null,
      },
    });
    expect(ids).toEqual(['log-1', 'log-2']);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls[0][2]).toEqual({ jobId: 'log-1' });
    const channels = queue.add.mock.calls.map((c) => c[1].channel);
    expect(channels).toEqual([
      NotificationChannel.SLACK,
      NotificationChannel.EMAIL,
    ]);
  });

  it('skips channels the template cannot render', async () => {
    await service.notify({
      template: 'PASSWORD_CHANGED',
      to: { email: 'a@b.c' },
      data: { firstName: 'A' },
      channels: [NotificationChannel.EMAIL, NotificationChannel.SLACK],
    });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('deduplicates: no job when the log insert was ignored', async () => {
    execute.mockResolvedValueOnce({ raw: [] });
    const ids = await service.notify({
      template: 'TEST',
      to: { userId: 'u1' },
      data: { firstName: 'A' },
      channels: [NotificationChannel.EMAIL],
      dedupeKey: 'test:u1',
    });
    expect(ids).toEqual([]);
    expect(queue.add).not.toHaveBeenCalled();
    expect(values.mock.calls[0][0].dedupeKey).toBe('test:u1:EMAIL');
  });

  it('redacts links/tokens from the persisted payload but not from the job', async () => {
    await service.notify({
      template: 'USER_INVITED',
      to: { email: 'a@b.c' },
      data: {
        firstName: 'A',
        inviteUrl: 'https://x/accept?token=SECRET',
        expiresAt: 'e',
      },
    });
    expect(values.mock.calls[0][0].payload).toEqual({
      firstName: 'A',
      inviteUrl: '[redacted]',
      expiresAt: 'e',
    });
    expect(queue.add.mock.calls[0][1].data.inviteUrl).toContain('SECRET');
  });
});
