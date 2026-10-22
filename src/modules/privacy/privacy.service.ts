import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DocumentsService } from '../documents/documents.service';

/**
 * Personal data held about one employee/user, section by section. `@emp` is
 * the employee id, `@user` the user id (either may be null). Secrets are never
 * exported: password hash, MFA seed/recovery codes, token hashes.
 * Add a section here whenever a new table stores personal data.
 */
const EMPLOYEE_SECTIONS: { key: string; sql: string }[] = [
  {
    key: 'account',
    sql: `SELECT id, email, first_name, last_name, status, mfa_enabled,
                 last_login_at, created_at, updated_at
            FROM users WHERE id = @user`,
  },
  {
    key: 'roles',
    sql: `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = @user`,
  },
  {
    key: 'sessions',
    sql: `SELECT id, created_at, expires_at, revoked_at, user_agent, ip_address
            FROM refresh_tokens WHERE user_id = @user ORDER BY created_at`,
  },
  { key: 'employee', sql: `SELECT * FROM employees WHERE id = @emp` },
  {
    key: 'employmentHistory',
    sql: `SELECT * FROM employment_history WHERE employee_id = @emp ORDER BY effective_date`,
  },
  {
    key: 'leaveBalances',
    sql: `SELECT * FROM leave_balances WHERE employee_id = @emp`,
  },
  {
    key: 'leaveAdjustments',
    sql: `SELECT a.* FROM leave_balance_adjustments a
            JOIN leave_balances b ON b.id = a.balance_id WHERE b.employee_id = @emp`,
  },
  {
    key: 'leaveRequests',
    sql: `SELECT * FROM leave_requests WHERE employee_id = @emp`,
  },
  {
    key: 'attendance',
    sql: `SELECT * FROM attendance_records WHERE employee_id = @emp`,
  },
  {
    key: 'documents',
    sql: `SELECT id, title, description, category, visibility, created_at, updated_at, deleted_at
            FROM documents WHERE owner_employee_id = @emp`,
  },
  {
    key: 'checklists',
    sql: `SELECT * FROM checklists WHERE employee_id = @emp`,
  },
  {
    key: 'checklistTasks',
    sql: `SELECT t.* FROM checklist_tasks t
            JOIN checklists c ON c.id = t.checklist_id WHERE c.employee_id = @emp`,
  },
  { key: 'reviews', sql: `SELECT * FROM reviews WHERE employee_id = @emp` },
  {
    key: 'reviewFeedbackReceived',
    sql: `SELECT f.* FROM review_feedback f
            JOIN reviews r ON r.id = f.review_id WHERE r.employee_id = @emp`,
  },
  {
    key: 'reviewFeedbackGiven',
    sql: `SELECT * FROM review_feedback WHERE giver_user_id = @user`,
  },
  { key: 'goals', sql: `SELECT * FROM goals WHERE employee_id = @emp` },
  {
    key: 'salaryStructures',
    sql: `SELECT * FROM salary_structures WHERE employee_id = @emp`,
  },
  { key: 'payslips', sql: `SELECT * FROM payslips WHERE employee_id = @emp` },
  {
    key: 'notificationPreferences',
    sql: `SELECT * FROM notification_preferences WHERE user_id = @user`,
  },
  {
    key: 'notifications',
    sql: `SELECT * FROM notification_log WHERE recipient_user_id = @user ORDER BY created_at`,
  },
  {
    key: 'aiConversations',
    sql: `SELECT * FROM ai_conversations WHERE user_id = @user`,
  },
  {
    key: 'aiMessages',
    sql: `SELECT m.* FROM ai_messages m
            JOIN ai_conversations c ON c.id = m.conversation_id
           WHERE c.user_id = @user ORDER BY m.created_at`,
  },
  {
    key: 'auditTrail',
    sql: `SELECT * FROM audit_logs
           WHERE actor_user_id::text = @user OR resource_id IN (@emp, @user)
           ORDER BY created_at`,
  },
];

const CANDIDATE_SECTIONS: { key: string; sql: string }[] = [
  { key: 'candidate', sql: `SELECT * FROM candidates WHERE id = @candidate` },
  {
    key: 'applications',
    sql: `SELECT * FROM applications WHERE candidate_id = @candidate`,
  },
  {
    key: 'resumes',
    sql: `SELECT d.id, d.title, d.created_at FROM documents d
            JOIN applications a ON a.resume_document_id = d.id
           WHERE a.candidate_id = @candidate`,
  },
];

/**
 * `@name` markers → `$1…$n`, passing only the values a query uses (Postgres
 * rejects parameters it can't type because they're unreferenced).
 */
export function bind(
  sql: string,
  values: Record<string, string | null>,
): [string, (string | null)[]] {
  const names: string[] = [];
  const text = sql.replace(/@(\w+)/g, (_, name: string) => {
    if (!(name in values)) throw new Error(`No value for @${name}`);
    if (!names.includes(name)) names.push(name);
    return `$${names.indexOf(name) + 1}`;
  });
  return [text, names.map((n) => values[n])];
}

export interface DataExport {
  subject: Record<string, string | null>;
  generatedAt: string;
  note: string;
  data: Record<string, unknown[]>;
}

/** NDPA data-subject rights: access (export) and, for candidates, erasure. */
@Injectable()
export class PrivacyService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly documents: DocumentsService,
  ) {}

  async exportEmployee(employeeId: string): Promise<DataExport> {
    const [emp] = await this.ds.query(
      `SELECT id, user_id FROM employees WHERE id = $1`,
      [employeeId],
    );
    if (!emp) throw new NotFoundException('Employee not found');
    return this.collect(EMPLOYEE_SECTIONS, {
      emp: emp.id,
      user: emp.user_id,
    });
  }

  /** For a login with or without an employee record. */
  async exportUser(userId: string): Promise<DataExport> {
    const [emp] = await this.ds.query(
      `SELECT id FROM employees WHERE user_id = $1`,
      [userId],
    );
    return this.collect(EMPLOYEE_SECTIONS, {
      emp: emp?.id ?? null,
      user: userId,
    });
  }

  async exportCandidate(candidateId: string): Promise<DataExport> {
    await this.requireCandidate(candidateId);
    return this.collect(CANDIDATE_SECTIONS, { candidate: candidateId });
  }

  /**
   * Right to erasure for applicants: applications, résumé files and the
   * candidate record are deleted for good. (Employees' records are kept for
   * the statutory periods — payroll, tax, pension — so there's no erasure
   * for them here.)
   */
  async eraseCandidate(
    candidateId: string,
  ): Promise<{ applications: number; resumes: number }> {
    await this.requireCandidate(candidateId);
    const apps: { id: string; resume_document_id: string }[] =
      await this.ds.query(
        `SELECT id, resume_document_id FROM applications WHERE candidate_id = $1`,
        [candidateId],
      );
    await this.ds.query(`DELETE FROM applications WHERE candidate_id = $1`, [
      candidateId,
    ]);
    for (const a of apps) await this.documents.purge(a.resume_document_id);
    await this.ds.query(`DELETE FROM candidates WHERE id = $1`, [candidateId]);
    return { applications: apps.length, resumes: apps.length };
  }

  private async collect(
    sections: { key: string; sql: string }[],
    subject: Record<string, string | null>,
  ): Promise<DataExport> {
    const data: Record<string, unknown[]> = {};
    for (const s of sections)
      data[s.key] = await this.ds.query(...bind(s.sql, subject));
    return {
      subject,
      generatedAt: new Date().toISOString(),
      note: 'Document files are listed but not included; download them through the documents API.',
      data,
    };
  }

  private async requireCandidate(id: string): Promise<void> {
    const [c] = await this.ds.query(`SELECT id FROM candidates WHERE id = $1`, [
      id,
    ]);
    if (!c) throw new NotFoundException('Candidate not found');
  }
}
