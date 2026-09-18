import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { MailService } from '../../infrastructure/mail/mail.service';
import { SlackService } from '../../infrastructure/slack/slack.service';
import { UsersService } from '../users/users.service';
import {
  NotificationChannel,
  NotificationStatus,
} from './entities/notification-log.entity';
import { NotificationLog } from './entities/notification-log.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationsProcessor } from './notifications.processor';
import type { NotificationJobData } from './notifications.types';

function job(
  data: Partial<NotificationJobData>,
  attemptsMade = 0,
  attempts = 5,
): Job<NotificationJobData> {
  return {
    data: {
      logId: 'log-1',
      template: 'TEST',
      channel: NotificationChannel.EMAIL,
      to: {},
      data: { firstName: 'A' },
      ...data,
    },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<NotificationJobData>;
}

describe('NotificationsProcessor', () => {
  let processor: NotificationsProcessor;
  let logs: { findOne: jest.Mock; update: jest.Mock };
  let prefs: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let users: { findById: jest.Mock };
  let mail: { send: jest.Mock };
  let slack: {
    isConfigured: boolean;
    post: jest.Mock;
    lookupUserIdByEmail: jest.Mock;
  };

  beforeEach(async () => {
    logs = {
      findOne: jest.fn(async () => ({
        id: 'log-1',
        status: NotificationStatus.QUEUED,
      })),
      update: jest.fn(),
    };
    prefs = {
      findOne: jest.fn(async () => null),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
    };
    users = {
      findById: jest.fn(async () => ({
        id: 'u1',
        email: 'u1@co.com',
        firstName: 'U',
      })),
    };
    mail = { send: jest.fn(async () => ({ messageId: '<m1>' })) };
    slack = {
      isConfigured: true,
      post: jest.fn(async () => ({ ts: '1.2' })),
      lookupUserIdByEmail: jest.fn(async () => 'U123'),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsProcessor,
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              ({
                APP_NAME: 'HR',
                APP_URL: 'https://hr',
                WORKERS_ENABLED: true,
                NOTIFICATIONS_CONCURRENCY: 2,
              })[k],
          },
        },
        { provide: getRepositoryToken(NotificationLog), useValue: logs },
        {
          provide: getRepositoryToken(NotificationPreference),
          useValue: prefs,
        },
        { provide: UsersService, useValue: users },
        { provide: MailService, useValue: mail },
        { provide: SlackService, useValue: slack },
        { provide: Logger, useValue: { warn: jest.fn(), debug: jest.fn() } },
      ],
    }).compile();
    processor = moduleRef.get(NotificationsProcessor);
  });

  it('emails a user via their account address and marks SENT with the provider ref', async () => {
    await processor.process(job({ to: { userId: 'u1' } }));

    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'u1@co.com',
        subject: expect.stringContaining('test'),
      }),
    );
    expect(logs.update).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({
        status: NotificationStatus.SENT,
        providerRef: '<m1>',
      }),
    );
  });

  it('SKIPs when the user disabled email', async () => {
    prefs.findOne.mockResolvedValue({
      userId: 'u1',
      emailEnabled: false,
      slackEnabled: true,
    });
    await processor.process(job({ to: { userId: 'u1' } }));
    expect(mail.send).not.toHaveBeenCalled();
    expect(logs.update).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({
        status: NotificationStatus.SKIPPED,
        error: 'email disabled by user',
      }),
    );
  });

  it('is idempotent: already-SENT logs are not re-delivered', async () => {
    logs.findOne.mockResolvedValue({
      id: 'log-1',
      status: NotificationStatus.SENT,
    });
    await processor.process(job({ to: { email: 'x@y.z' } }));
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('Slack: resolves the member id by email once and caches it in preferences', async () => {
    await processor.process(
      job({ channel: NotificationChannel.SLACK, to: { userId: 'u1' } }),
    );

    expect(slack.lookupUserIdByEmail).toHaveBeenCalledWith('u1@co.com');
    expect(prefs.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', slackUserId: 'U123' }),
    );
    expect(slack.post).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'U123' }),
    );
    expect(logs.update).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({
        status: NotificationStatus.SENT,
        providerRef: '1.2',
      }),
    );
  });

  it('Slack: SKIPs when not configured, or when the member cannot be found', async () => {
    slack.isConfigured = false;
    await processor.process(
      job({ channel: NotificationChannel.SLACK, to: { userId: 'u1' } }),
    );
    expect(logs.update).toHaveBeenLastCalledWith(
      'log-1',
      expect.objectContaining({ status: NotificationStatus.SKIPPED }),
    );

    slack.isConfigured = true;
    slack.lookupUserIdByEmail.mockResolvedValue(null);
    await processor.process(
      job({ channel: NotificationChannel.SLACK, to: { userId: 'u1' } }),
    );
    expect(logs.update).toHaveBeenLastCalledWith(
      'log-1',
      expect.objectContaining({
        status: NotificationStatus.SKIPPED,
        error: 'no slack destination for recipient',
      }),
    );
    expect(slack.post).not.toHaveBeenCalled();
  });

  it('provider failure: stays QUEUED with the error until attempts are exhausted, then FAILED; always rethrows', async () => {
    mail.send.mockRejectedValue(new Error('SMTP down'));

    await expect(
      processor.process(job({ to: { email: 'x@y.z' } }, 0, 5)),
    ).rejects.toThrow('SMTP down');
    expect(logs.update).toHaveBeenLastCalledWith(
      'log-1',
      expect.objectContaining({
        status: NotificationStatus.QUEUED,
        error: 'SMTP down',
        attempts: 1,
      }),
    );

    await expect(
      processor.process(job({ to: { email: 'x@y.z' } }, 4, 5)),
    ).rejects.toThrow('SMTP down');
    expect(logs.update).toHaveBeenLastCalledWith(
      'log-1',
      expect.objectContaining({
        status: NotificationStatus.FAILED,
        attempts: 5,
      }),
    );
  });
});
