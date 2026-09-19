import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { EmployeesModule } from '../employees/employees.module';
import { Employee } from '../employees/entities/employee.entity';
import { LeaveRequest } from '../leave/entities/leave-request.entity';
import { AttendanceController } from './attendance.controller';
import { AttendanceProcessor } from './attendance.processor';
import { AttendanceService } from './attendance.service';
import { AttendanceRecord } from './entities/attendance-record.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AttendanceRecord, Employee, LeaveRequest]),
    QueueModule,
    BullModule.registerQueue({ name: QUEUES.ATTENDANCE }),
    EmployeesModule,
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceProcessor],
  exports: [AttendanceService],
})
export class AttendanceModule {}
