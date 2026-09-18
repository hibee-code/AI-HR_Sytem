import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { UsersModule } from '../users/users.module';
import { DepartmentsService } from './departments.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { Department } from './entities/department.entity';
import { Employee } from './entities/employee.entity';
import { EmploymentHistory } from './entities/employment-history.entity';
import { Position } from './entities/position.entity';
import { OrgController } from './org.controller';
import { PositionsService } from './positions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Employee,
      EmploymentHistory,
      Department,
      Position,
    ]),
    UsersModule,
    AuthModule,
    RbacModule,
  ],
  controllers: [OrgController, EmployeesController],
  providers: [EmployeesService, DepartmentsService, PositionsService],
  exports: [EmployeesService, DepartmentsService],
})
export class EmployeesModule {}
