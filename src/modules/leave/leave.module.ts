import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { EmployeesModule } from '../employees/employees.module';
import { Employee } from '../employees/entities/employee.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeaveBalanceAdjustment } from './entities/leave-balance-adjustment.entity';
import { LeaveBalance } from './entities/leave-balance.entity';
import { LeaveRequest } from './entities/leave-request.entity';
import { LeaveType } from './entities/leave-type.entity';
import { PublicHoliday } from './entities/public-holiday.entity';
import { LeavePolicyService } from './leave-policy.service';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveController } from './leave.controller';
import { LeaveProcessor } from './leave.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LeaveType,
      PublicHoliday,
      LeaveBalance,
      LeaveBalanceAdjustment,
      LeaveRequest,
      Employee,
    ]),
    QueueModule,
    BullModule.registerQueue({ name: QUEUES.LEAVE }),
    EmployeesModule,
    NotificationsModule,
  ],
  controllers: [LeaveController],
  providers: [LeavePolicyService, LeaveRequestsService, LeaveProcessor],
  exports: [LeavePolicyService, LeaveRequestsService],
})
export class LeaveModule {}
