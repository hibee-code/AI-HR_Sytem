import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentsModule } from '../documents/documents.module';
import { EmployeesModule } from '../employees/employees.module';
import { Employee } from '../employees/entities/employee.entity';
import type { Env } from '../../config/env.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { PayrollRun } from './entities/payroll-run.entity';
import { Payslip } from './entities/payslip.entity';
import { SalaryStructure } from './entities/salary-structure.entity';
import {
  DefaultPayrollCalculator,
  PAYROLL_CALCULATOR,
} from './payroll-calculator';
import { NigeriaPayrollCalculator } from './nigeria-payroll.calculator';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SalaryStructure, PayrollRun, Payslip, Employee]),
    EmployeesModule,
    DocumentsModule,
    NotificationsModule,
  ],
  controllers: [PayrollController],
  providers: [
    PayrollService,
    {
      provide: PAYROLL_CALCULATOR,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('PAYROLL_CALCULATOR', { infer: true }) === 'nigeria'
          ? new NigeriaPayrollCalculator()
          : new DefaultPayrollCalculator(),
    },
  ],
  exports: [PayrollService],
})
export class PayrollModule {}
