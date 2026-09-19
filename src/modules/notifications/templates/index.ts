import { NotificationChannel } from '../entities/notification-log.entity';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface RenderedSlack {
  text: string;
  blocks?: unknown[];
}

export interface TemplateContext {
  appName: string;
  appUrl: string;
}

interface TemplateDef<D> {
  /** Channels used when the caller doesn't specify any. */
  defaultChannels: NotificationChannel[];
  email?: (data: D, ctx: TemplateContext) => RenderedEmail;
  slack?: (data: D, ctx: TemplateContext) => RenderedSlack;
}

// ── Data shapes ──────────────────────────────────────────────────────────

export interface TemplateData {
  USER_INVITED: { firstName: string; inviteUrl: string; expiresAt: string };
  PASSWORD_RESET: { firstName: string; resetUrl: string; expiresAt: string };
  PASSWORD_CHANGED: { firstName: string };
  EMPLOYEE_WELCOME: {
    firstName: string;
    startDate: string;
    department: string;
    managerName: string | null;
  };
  NEW_HIRE_FOR_MANAGER: {
    managerFirstName: string;
    employeeName: string;
    startDate: string;
    department: string;
    position: string | null;
  };
  EMPLOYEE_TERMINATED: {
    employeeName: string;
    department: string;
    terminationDate: string;
  };
  TASKS_DUE: {
    firstName: string;
    taskCount: number;
    overdueCount: number;
    taskSummary: string;
  };
  LEAVE_REQUESTED: {
    employeeName: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    days: number;
    reason: string;
  };
  LEAVE_DECIDED: {
    firstName: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    days: number;
    decision: string;
    note: string;
  };
  LEAVE_CANCELLED: {
    employeeName: string;
    leaveType: string;
    startDate: string;
    endDate: string;
  };
  REVIEW_CYCLE_LAUNCHED: {
    firstName: string;
    cycleName: string;
    selfReviewDeadline: string;
  };
  REVIEW_ACTION_REQUIRED: {
    firstName: string;
    action: string;
    cycleName: string;
    deadline: string;
  };
  REVIEW_COMPLETED: {
    firstName: string;
    cycleName: string;
    ratingLabel: string;
  };
  FEEDBACK_REQUESTED: {
    firstName: string;
    aboutName: string;
    cycleName: string;
    deadline: string;
  };
  TEST: { firstName: string };
}

export type TemplateName = keyof TemplateData;

// ── Helpers ──────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/** Minimal, inbox-safe HTML shell shared by every email. */
function layout(ctx: TemplateContext, title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">${esc(title)}</h2>
${bodyHtml}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
<p style="font-size:12px;color:#6b7280">${esc(ctx.appName)} · <a href="${esc(ctx.appUrl)}">${esc(ctx.appUrl)}</a></p>
</body></html>`;
}

const p = (s: string) => `<p style="margin:0 0 12px">${s}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${esc(href)}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${esc(label)}</a></p>`;
const fmtDate = (iso: string) => new Date(iso).toUTCString();

// ── Registry ─────────────────────────────────────────────────────────────

export const TEMPLATES: { [K in TemplateName]: TemplateDef<TemplateData[K]> } =
  {
    USER_INVITED: {
      defaultChannels: [NotificationChannel.EMAIL],
      email: (d, ctx) => ({
        subject: `You're invited to ${ctx.appName}`,
        text: `Hi ${d.firstName},\n\nYou've been invited to ${ctx.appName}. Set your password here:\n${d.inviteUrl}\n\nThis link expires ${fmtDate(d.expiresAt)}.`,
        html: layout(
          ctx,
          `Welcome to ${ctx.appName}`,
          p(`Hi ${esc(d.firstName)},`) +
            p(
              `You've been invited to ${esc(ctx.appName)}. Click below to set your password.`,
            ) +
            button(d.inviteUrl, 'Accept invitation') +
            p(`<small>This link expires ${esc(fmtDate(d.expiresAt))}.</small>`),
        ),
      }),
    },

    PASSWORD_RESET: {
      defaultChannels: [NotificationChannel.EMAIL],
      email: (d, ctx) => ({
        subject: `Reset your ${ctx.appName} password`,
        text: `Hi ${d.firstName},\n\nReset your password here:\n${d.resetUrl}\n\nThis link expires ${fmtDate(d.expiresAt)}. If you didn't request this, ignore this email.`,
        html: layout(
          ctx,
          'Password reset',
          p(`Hi ${esc(d.firstName)},`) +
            p('We received a request to reset your password.') +
            button(d.resetUrl, 'Reset password') +
            p(
              `<small>This link expires ${esc(fmtDate(d.expiresAt))}. If you didn't request this, you can ignore this email.</small>`,
            ),
        ),
      }),
    },

    PASSWORD_CHANGED: {
      defaultChannels: [NotificationChannel.EMAIL],
      email: (d, ctx) => ({
        subject: `Your ${ctx.appName} password was changed`,
        text: `Hi ${d.firstName},\n\nYour password was just changed and all other sessions were signed out. If this wasn't you, contact HR immediately.`,
        html: layout(
          ctx,
          'Password changed',
          p(`Hi ${esc(d.firstName)},`) +
            p(
              'Your password was just changed and all other sessions were signed out.',
            ) +
            p("<strong>If this wasn't you, contact HR immediately.</strong>"),
        ),
      }),
    },

    EMPLOYEE_WELCOME: {
      defaultChannels: [NotificationChannel.EMAIL],
      email: (d, ctx) => ({
        subject: `Welcome to the team, ${d.firstName}!`,
        text: `Hi ${d.firstName},\n\nWe're excited to have you join ${d.department} on ${d.startDate}.${d.managerName ? ` Your manager will be ${d.managerName}.` : ''}\n\nSee you soon!`,
        html: layout(
          ctx,
          `Welcome, ${d.firstName}!`,
          p(
            `We're excited to have you join <strong>${esc(d.department)}</strong> on <strong>${esc(d.startDate)}</strong>.`,
          ) +
            (d.managerName
              ? p(`Your manager will be ${esc(d.managerName)}.`)
              : '') +
            p('See you soon!'),
        ),
      }),
    },

    NEW_HIRE_FOR_MANAGER: {
      defaultChannels: [NotificationChannel.SLACK, NotificationChannel.EMAIL],
      email: (d, ctx) => ({
        subject: `New hire joining your team: ${d.employeeName}`,
        text: `Hi ${d.managerFirstName},\n\n${d.employeeName} joins ${d.department}${d.position ? ` as ${d.position}` : ''} on ${d.startDate} and will report to you.`,
        html: layout(
          ctx,
          'New team member',
          p(`Hi ${esc(d.managerFirstName)},`) +
            p(
              `<strong>${esc(d.employeeName)}</strong> joins ${esc(d.department)}${d.position ? ` as ${esc(d.position)}` : ''} on <strong>${esc(d.startDate)}</strong> and will report to you.`,
            ),
        ),
      }),
      slack: (d) => ({
        text: `:wave: *${d.employeeName}* joins ${d.department}${d.position ? ` as ${d.position}` : ''} on ${d.startDate} and will report to you.`,
      }),
    },

    EMPLOYEE_TERMINATED: {
      defaultChannels: [NotificationChannel.SLACK],
      slack: (d) => ({
        text: `:door: *${d.employeeName}* (${d.department}) — last day ${d.terminationDate}. Offboarding checklist applies.`,
      }),
      email: (d, ctx) => ({
        subject: `Offboarding: ${d.employeeName}`,
        text: `${d.employeeName} (${d.department}) — last day ${d.terminationDate}.`,
        html: layout(
          ctx,
          'Offboarding',
          p(
            `<strong>${esc(d.employeeName)}</strong> (${esc(d.department)}) — last day ${esc(d.terminationDate)}.`,
          ),
        ),
      }),
    },

    TASKS_DUE: {
      defaultChannels: [NotificationChannel.SLACK, NotificationChannel.EMAIL],
      email: (d, ctx) => ({
        subject: `${d.taskCount} onboarding task${d.taskCount === 1 ? '' : 's'} need your attention${d.overdueCount ? ` (${d.overdueCount} overdue)` : ''}`,
        text: `Hi ${d.firstName},\n\nThese tasks are due soon or overdue:\n\n${d.taskSummary}\n\nOpen ${ctx.appUrl} to complete them.`,
        html: layout(
          ctx,
          'Tasks due',
          p(`Hi ${esc(d.firstName)},`) +
            p('These tasks are due soon or overdue:') +
            `<pre style="white-space:pre-wrap;font-family:inherit">${esc(d.taskSummary)}</pre>` +
            button(ctx.appUrl, 'Open my tasks'),
        ),
      }),
      slack: (d) => ({
        text: `:clipboard: *${d.taskCount} task${d.taskCount === 1 ? '' : 's'}* need your attention${d.overdueCount ? ` (${d.overdueCount} overdue)` : ''}:\n${d.taskSummary}`,
      }),
    },

    LEAVE_REQUESTED: {
      defaultChannels: [NotificationChannel.SLACK, NotificationChannel.EMAIL],
      email: (d, ctx) => ({
        subject: `Leave request from ${d.employeeName}: ${d.leaveType}, ${d.startDate} → ${d.endDate}`,
        text: `${d.employeeName} requested ${d.days} day(s) of ${d.leaveType} from ${d.startDate} to ${d.endDate}.${d.reason ? `\nReason: ${d.reason}` : ''}\n\nReview it at ${ctx.appUrl}.`,
        html: layout(
          ctx,
          'Leave request',
          p(
            `<strong>${esc(d.employeeName)}</strong> requested <strong>${d.days}</strong> day(s) of ${esc(d.leaveType)} from <strong>${esc(d.startDate)}</strong> to <strong>${esc(d.endDate)}</strong>.`,
          ) +
            (d.reason ? p(`Reason: ${esc(d.reason)}`) : '') +
            button(ctx.appUrl, 'Review request'),
        ),
      }),
      slack: (d) => ({
        text: `:palm_tree: *${d.employeeName}* requested ${d.days} day(s) of ${d.leaveType}: ${d.startDate} → ${d.endDate}${d.reason ? ` — _${d.reason}_` : ''}`,
      }),
    },

    LEAVE_DECIDED: {
      defaultChannels: [NotificationChannel.SLACK, NotificationChannel.EMAIL],
      email: (d, ctx) => ({
        subject: `Your ${d.leaveType} request was ${d.decision}`,
        text: `Hi ${d.firstName},\n\nYour ${d.leaveType} request (${d.startDate} → ${d.endDate}, ${d.days} day(s)) was ${d.decision}.${d.note ? `\nNote: ${d.note}` : ''}`,
        html: layout(
          ctx,
          `Leave ${d.decision}`,
          p(`Hi ${esc(d.firstName)},`) +
            p(
              `Your ${esc(d.leaveType)} request (<strong>${esc(d.startDate)}</strong> → <strong>${esc(d.endDate)}</strong>, ${d.days} day(s)) was <strong>${esc(d.decision)}</strong>.`,
            ) +
            (d.note ? p(`Note: ${esc(d.note)}`) : ''),
        ),
      }),
      slack: (d) => ({
        text: `${d.decision === 'approved' ? ':white_check_mark:' : ':x:'} Your ${d.leaveType} request (${d.startDate} → ${d.endDate}) was *${d.decision}*${d.note ? ` — _${d.note}_` : ''}`,
      }),
    },

    LEAVE_CANCELLED: {
      defaultChannels: [NotificationChannel.SLACK],
      slack: (d) => ({
        text: `:leftwards_arrow_with_hook: *${d.employeeName}* cancelled their ${d.leaveType} request (${d.startDate} → ${d.endDate}).`,
      }),
      email: (d, ctx) => ({
        subject: `Leave cancelled: ${d.employeeName}`,
        text: `${d.employeeName} cancelled their ${d.leaveType} request (${d.startDate} → ${d.endDate}).`,
        html: layout(
          ctx,
          'Leave cancelled',
          p(
            `<strong>${esc(d.employeeName)}</strong> cancelled their ${esc(d.leaveType)} request (${esc(d.startDate)} → ${esc(d.endDate)}).`,
          ),
        ),
      }),
    },

    REVIEW_CYCLE_LAUNCHED: {
      defaultChannels: [NotificationChannel.SLACK, NotificationChannel.EMAIL],
      email: (d, ctx) => ({
        subject: `${d.cycleName}: your self-review is open`,
        text: `Hi ${d.firstName},\n\nThe ${d.cycleName} review cycle has started. Please complete your self-review by ${d.selfReviewDeadline}.\n\n${ctx.appUrl}`,
        html: layout(
          ctx,
          'Self-review open',
          p(`Hi ${esc(d.firstName)},`) +
            p(
              `The <strong>${esc(d.cycleName)}</strong> review cycle has started. Please complete your self-review by <strong>${esc(d.selfReviewDeadline)}</strong>.`,
            ) +
            button(ctx.appUrl, 'Start self-review'),
        ),
      }),
      slack: (d) => ({
        text: `:memo: *${d.cycleName}* has started — complete your self-review by ${d.selfReviewDeadline}.`,
      }),
    },

    REVIEW_ACTION_REQUIRED: {
      defaultChannels: [NotificationChannel.SLACK, NotificationChannel.EMAIL],
      email: (d, ctx) => ({
        subject: `Reminder: ${d.action} for ${d.cycleName} by ${d.deadline}`,
        text: `Hi ${d.firstName},\n\nPlease ${d.action} for ${d.cycleName}. Deadline: ${d.deadline}.\n\n${ctx.appUrl}`,
        html: layout(
          ctx,
          'Review reminder',
          p(`Hi ${esc(d.firstName)},`) +
            p(
              `Please ${esc(d.action)} for <strong>${esc(d.cycleName)}</strong>. Deadline: <strong>${esc(d.deadline)}</strong>.`,
            ) +
            button(ctx.appUrl, 'Open reviews'),
        ),
      }),
      slack: (d) => ({
        text: `:alarm_clock: Please ${d.action} for *${d.cycleName}* — deadline ${d.deadline}.`,
      }),
    },

    REVIEW_COMPLETED: {
      defaultChannels: [NotificationChannel.EMAIL],
      email: (d, ctx) => ({
        subject: `Your ${d.cycleName} review is ready`,
        text: `Hi ${d.firstName},\n\nYour ${d.cycleName} review is complete (overall: ${d.ratingLabel}). Please read it and acknowledge.\n\n${ctx.appUrl}`,
        html: layout(
          ctx,
          'Review complete',
          p(`Hi ${esc(d.firstName)},`) +
            p(
              `Your <strong>${esc(d.cycleName)}</strong> review is complete (overall: <strong>${esc(d.ratingLabel)}</strong>). Please read it and acknowledge.`,
            ) +
            button(ctx.appUrl, 'View review'),
        ),
      }),
      slack: (d) => ({
        text: `:star: Your *${d.cycleName}* review is ready to read and acknowledge.`,
      }),
    },

    FEEDBACK_REQUESTED: {
      defaultChannels: [NotificationChannel.SLACK, NotificationChannel.EMAIL],
      email: (d, ctx) => ({
        subject: `Feedback requested: ${d.aboutName} (${d.cycleName})`,
        text: `Hi ${d.firstName},\n\nYou've been asked for feedback on ${d.aboutName} for ${d.cycleName}. Please respond by ${d.deadline}.\n\n${ctx.appUrl}`,
        html: layout(
          ctx,
          'Feedback requested',
          p(`Hi ${esc(d.firstName)},`) +
            p(
              `You've been asked for feedback on <strong>${esc(d.aboutName)}</strong> for ${esc(d.cycleName)}. Please respond by <strong>${esc(d.deadline)}</strong>.`,
            ) +
            button(ctx.appUrl, 'Give feedback'),
        ),
      }),
      slack: (d) => ({
        text: `:speech_balloon: Feedback requested on *${d.aboutName}* (${d.cycleName}) — by ${d.deadline}.`,
      }),
    },

    TEST: {
      defaultChannels: [NotificationChannel.EMAIL, NotificationChannel.SLACK],
      email: (d, ctx) => ({
        subject: `${ctx.appName} test notification`,
        text: `Hi ${d.firstName}, this is a test. If you can read this, email delivery works.`,
        html: layout(
          ctx,
          'Test notification',
          p(
            `Hi ${esc(d.firstName)}, this is a test. If you can read this, email delivery works.`,
          ),
        ),
      }),
      slack: (d) => ({
        text: `Hi ${d.firstName}, this is a test. Slack delivery works. :white_check_mark:`,
      }),
    },
  };
