import { NotificationChannel } from '../entities/notification-log.entity';
import { TEMPLATES, TemplateContext, TemplateName } from './index';

const ctx: TemplateContext = {
  appName: 'HR System',
  appUrl: 'https://hr.example.com',
};

const SAMPLE: {
  [K in TemplateName]: Parameters<
    NonNullable<(typeof TEMPLATES)[K]['email' | 'slack']>
  >[0];
} = {
  USER_INVITED: {
    firstName: 'Jane',
    inviteUrl: 'https://hr.example.com/accept?token=abc',
    expiresAt: '2026-10-01T00:00:00Z',
  },
  PASSWORD_RESET: {
    firstName: 'Jane',
    resetUrl: 'https://hr.example.com/reset?token=abc',
    expiresAt: '2026-10-01T00:00:00Z',
  },
  PASSWORD_CHANGED: { firstName: 'Jane' },
  EMPLOYEE_WELCOME: {
    firstName: 'Jane',
    startDate: '2026-10-01',
    department: 'Eng',
    managerName: 'Bob',
  },
  NEW_HIRE_FOR_MANAGER: {
    managerFirstName: 'Bob',
    employeeName: 'Jane Doe',
    startDate: '2026-10-01',
    department: 'Eng',
    position: null,
  },
  EMPLOYEE_TERMINATED: {
    employeeName: 'Jane Doe',
    department: 'Eng',
    terminationDate: '2026-12-31',
  },
  TASKS_DUE: {
    firstName: 'Jane',
    taskCount: 2,
    overdueCount: 1,
    taskSummary:
      '• Sign contract — Jane Doe (OVERDUE by 1d)\n• Laptop — Jane Doe (due today)',
  },
  LEAVE_REQUESTED: {
    employeeName: 'Jane Doe',
    leaveType: 'Annual',
    startDate: '2026-12-21',
    endDate: '2026-12-24',
    days: 3,
    reason: 'Holiday',
  },
  LEAVE_DECIDED: {
    firstName: 'Jane',
    leaveType: 'Annual',
    startDate: '2026-12-21',
    endDate: '2026-12-24',
    days: 3,
    decision: 'approved',
    note: '',
  },
  LEAVE_CANCELLED: {
    employeeName: 'Jane Doe',
    leaveType: 'Annual',
    startDate: '2026-12-21',
    endDate: '2026-12-24',
  },
  REVIEW_CYCLE_LAUNCHED: {
    firstName: 'Jane',
    cycleName: 'H2',
    selfReviewDeadline: '2027-01-15',
  },
  REVIEW_ACTION_REQUIRED: {
    firstName: 'Jane',
    action: 'complete your self-review',
    cycleName: 'H2',
    deadline: '2027-01-15',
  },
  REVIEW_COMPLETED: {
    firstName: 'Jane',
    cycleName: 'H2',
    ratingLabel: 'Meets expectations',
  },
  FEEDBACK_REQUESTED: {
    firstName: 'Bob',
    aboutName: 'Jane Doe',
    cycleName: 'H2',
    deadline: '2027-01-31',
  },
  PAYSLIP_AVAILABLE: {
    firstName: 'Jane',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    payDate: '2026-10-28',
  },
  TEST: { firstName: 'Jane' },
};

describe('notification templates', () => {
  it.each(Object.keys(TEMPLATES) as TemplateName[])(
    '%s renders every default channel',
    (name) => {
      const def = TEMPLATES[name];
      expect(def.defaultChannels.length).toBeGreaterThan(0);
      for (const channel of def.defaultChannels) {
        if (channel === NotificationChannel.EMAIL) {
          const out = def.email!(SAMPLE[name] as never, ctx);
          expect(out.subject.length).toBeGreaterThan(0);
          expect(out.text.length).toBeGreaterThan(0);
          expect(out.html).toContain('<!doctype html>');
        } else {
          const out = def.slack!(SAMPLE[name] as never, ctx);
          expect(out.text.length).toBeGreaterThan(0);
        }
      }
    },
  );

  it('escapes HTML in user-provided values', () => {
    const out = TEMPLATES.EMPLOYEE_WELCOME.email!(
      {
        firstName: '<img src=x onerror=alert(1)>',
        startDate: '2026-10-01',
        department: 'R&D',
        managerName: null,
      },
      ctx,
    );
    expect(out.html).not.toContain('<img');
    expect(out.html).toContain('&lt;img');
    expect(out.html).toContain('R&amp;D');
  });

  it('invite email carries the link in both text and html', () => {
    const out = TEMPLATES.USER_INVITED.email!(SAMPLE.USER_INVITED, ctx);
    expect(out.text).toContain('token=abc');
    expect(out.html).toContain(
      'href="https://hr.example.com/accept?token=abc"',
    );
  });
});
