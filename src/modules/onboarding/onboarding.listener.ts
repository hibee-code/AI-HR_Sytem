import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from 'nestjs-pino';
import { EmployeeStatus } from '../employees/entities/employee.entity';
import {
  EMPLOYEE_EVENTS,
  EmployeeCreatedEvent,
  EmployeeTerminatedEvent,
} from '../employees/employees.events';
import { EmployeesService } from '../employees/employees.service';
import { ChecklistType } from './entities/checklist-template.entity';
import { OnboardingService } from './onboarding.service';

/** Employee lifecycle → checklists. Failures are logged, never propagated to the emitter. */
@Injectable()
export class OnboardingListener {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly employees: EmployeesService,
    private readonly logger: Logger,
  ) {}

  @OnEvent(EMPLOYEE_EVENTS.CREATED, { async: true, promisify: true })
  async onCreated(e: EmployeeCreatedEvent): Promise<void> {
    try {
      const emp = await this.employees.findById(e.employeeId);
      if (emp.status !== EmployeeStatus.ONBOARDING) return; // backfilled as ACTIVE: no checklist
      await this.onboarding.start(e.employeeId, ChecklistType.ONBOARDING, {
        anchorDate: e.hireDate,
        actorUserId: e.actorUserId,
      });
    } catch (err) {
      this.logger.error(
        { err, employeeId: e.employeeId },
        'failed to start onboarding checklist',
      );
    }
  }

  @OnEvent(EMPLOYEE_EVENTS.TERMINATED, { async: true, promisify: true })
  async onTerminated(e: EmployeeTerminatedEvent): Promise<void> {
    try {
      await this.onboarding.start(e.employeeId, ChecklistType.OFFBOARDING, {
        anchorDate: e.terminationDate,
        actorUserId: e.actorUserId,
      });
    } catch (err) {
      this.logger.error(
        { err, employeeId: e.employeeId },
        'failed to start offboarding checklist',
      );
    }
  }
}
