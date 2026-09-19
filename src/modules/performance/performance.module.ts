import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { EmployeesModule } from '../employees/employees.module';
import { Employee } from '../employees/entities/employee.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { CyclesService } from './cycles.service';
import { Goal } from './entities/goal.entity';
import { ReviewCycle } from './entities/review-cycle.entity';
import { ReviewFeedback } from './entities/review-feedback.entity';
import { Review } from './entities/review.entity';
import { GoalsService } from './goals.service';
import { PerformanceController } from './performance.controller';
import { PerformanceProcessor } from './performance.processor';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReviewCycle,
      Review,
      ReviewFeedback,
      Goal,
      Employee,
    ]),
    QueueModule,
    BullModule.registerQueue({ name: QUEUES.PERFORMANCE }),
    EmployeesModule,
    UsersModule,
    NotificationsModule,
  ],
  controllers: [PerformanceController],
  providers: [
    CyclesService,
    ReviewsService,
    GoalsService,
    PerformanceProcessor,
  ],
  exports: [CyclesService, ReviewsService, GoalsService],
})
export class PerformanceModule {}
