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
