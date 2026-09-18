import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from 'nestjs-pino';
import { SlackService } from '../../../infrastructure/slack/slack.service';
import {
  EMPLOYEE_EVENTS,
  EmployeeCreatedEvent,
  EmployeeTerminatedEvent,
} from '../../employees/employees.events';
import { EmployeesService } from '../../employees/employees.service';
import { NotificationChannel } from '../entities/notification-log.entity';
import { NotificationsService } from '../notifications.service';

/** Employee lifecycle → welcome mail, heads-up to the manager, HR channel on exit. */
@Injectable()
export class EmployeeNotificationsListener {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly employees: EmployeesService,
    private readonly slack: SlackService,
    private readonly logger: Logger,
  ) {}

  @OnEvent(EMPLOYEE_EVENTS.CREATED, { async: true, promisify: true })
  async onCreated(e: EmployeeCreatedEvent): Promise<void> {
    const emp = await this.employees.findById(e.employeeId).catch(() => null);
    if (!emp) return;

    await this.notifications.notify({
      template: 'EMPLOYEE_WELCOME',
      // Work email directly: the login may not exist or be accepted yet.
      to: { email: emp.workEmail, name: emp.firstName },
      data: {
        firstName: emp.firstName,
        startDate: emp.hireDate,
        department: emp.department.name,
        managerName: emp.manager?.fullName ?? null,
      },
      dedupeKey: `employee.welcome:${emp.id}`,
    });

    if (emp.manager) {
      await this.notifications.notify({
        template: 'NEW_HIRE_FOR_MANAGER',
        to: emp.manager.userId
          ? { userId: emp.manager.userId }
          : { email: emp.manager.workEmail, name: emp.manager.firstName },
        data: {
          managerFirstName: emp.manager.firstName,
          employeeName: emp.fullName,
          startDate: emp.hireDate,
          department: emp.department.name,
          position: emp.position?.title ?? null,
        },
        dedupeKey: `employee.new-hire-manager:${emp.id}`,
      });
    }
  }

  @OnEvent(EMPLOYEE_EVENTS.TERMINATED, { async: true, promisify: true })
  async onTerminated(e: EmployeeTerminatedEvent): Promise<void> {
    const emp = await this.employees.findById(e.employeeId).catch(() => null);
    if (!emp) return;
    if (!this.slack.isConfigured) {
      this.logger.debug(
        { employeeId: emp.id },
        'termination notice skipped: slack not configured',
      );
      return;
    }
    await this.notifications.notify({
      template: 'EMPLOYEE_TERMINATED',
      to: { slackChannel: this.slack.defaultChannel },
      channels: [NotificationChannel.SLACK],
      data: {
        employeeName: emp.fullName,
        department: emp.department.name,
        terminationDate: e.terminationDate,
      },
      dedupeKey: `employee.terminated:${emp.id}:${e.terminationDate}`,
    });
  }
}
