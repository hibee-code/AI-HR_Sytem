import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../../infrastructure/mail/mail.module';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { SlackModule } from '../../infrastructure/slack/slack.module';
import { EmployeesModule } from '../employees/employees.module';
import { UsersModule } from '../users/users.module';
import { NotificationLog } from './entities/notification-log.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { AuthNotificationsListener } from './listeners/auth-notifications.listener';
import { EmployeeNotificationsListener } from './listeners/employee-notifications.listener';
import { NotificationsController } from './notifications.controller';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationLog, NotificationPreference]),
    QueueModule,
    BullModule.registerQueue({ name: QUEUES.NOTIFICATIONS }),
    MailModule,
    SlackModule,
    UsersModule,
    EmployeesModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsProcessor,
    AuthNotificationsListener,
    EmployeeNotificationsListener,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
