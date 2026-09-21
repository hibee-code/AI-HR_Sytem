import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentsModule } from '../documents/documents.module';
import { EmployeesModule } from '../employees/employees.module';
import { Employee } from '../employees/entities/employee.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { PayrollRun } from './entities/payroll-run.entity';
import { Payslip } from './entities/payslip.entity';
import { SalaryStructure } from './entities/salary-structure.entity';
import {
  DefaultPayrollCalculator,
  PAYROLL_CALCULATOR,
} from './payroll-calculator';
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
    // Swap this binding to plug in a real tax/statutory engine.
    { provide: PAYROLL_CALCULATOR, useClass: DefaultPayrollCalculator },
  ],
  exports: [PayrollService],
})
export class PayrollModule {}
