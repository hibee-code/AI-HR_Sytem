import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { EmployeesModule } from '../employees/employees.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RbacModule } from '../rbac/rbac.module';
import { ChecklistTemplatesService } from './checklist-templates.service';
import { ChecklistTask } from './entities/checklist-task.entity';
import { ChecklistTemplateItem } from './entities/checklist-template-item.entity';
import { ChecklistTemplate } from './entities/checklist-template.entity';
import { Checklist } from './entities/checklist.entity';
import { OnboardingController } from './onboarding.controller';
import { OnboardingListener } from './onboarding.listener';
import { OnboardingProcessor } from './onboarding.processor';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChecklistTemplate,
      ChecklistTemplateItem,
      Checklist,
      ChecklistTask,
    ]),
    QueueModule,
    BullModule.registerQueue({ name: QUEUES.ONBOARDING }),
    EmployeesModule,
    NotificationsModule,
    RbacModule,
  ],
  controllers: [OnboardingController],
  providers: [
    ChecklistTemplatesService,
    OnboardingService,
    OnboardingListener,
    OnboardingProcessor,
  ],
  exports: [OnboardingService],
})
export class OnboardingModule {}
