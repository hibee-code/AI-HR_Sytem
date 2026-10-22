import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import type { Env } from '../../config/env.schema';
import { PrivacyService } from './privacy.service';

/**
 * Deletes personal data past its retention period (RETENTION_*_DAYS, 0 =
 * keep forever). Audit rows can only be deleted through the guarded path the
 * database allows (session flag + rows older than a year — see the
 * AuditRetention migration). Candidates are erased once every application of
 * theirs has been closed for the period; hired ones became employees.
 */
@Injectable()
export class RetentionService {
  private readonly days: Record<
    'audit' | 'conversations' | 'aiUsage' | 'notifications' | 'candidates',
    number
  >;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly privacy: PrivacyService,
    private readonly logger: Logger,
    config: ConfigService<Env, true>,
  ) {
    this.days = {
      audit: config.get('RETENTION_AUDIT_DAYS', { infer: true }),
      conversations: config.get('RETENTION_AI_CONVERSATION_DAYS', {
        infer: true,
      }),
      aiUsage: config.get('RETENTION_AI_USAGE_DAYS', { infer: true }),
      notifications: config.get('RETENTION_NOTIFICATION_LOG_DAYS', {
        infer: true,
      }),
      candidates: config.get('RETENTION_CANDIDATE_DAYS', { infer: true }),
    };
  }

  async run(now = new Date()): Promise<Record<string, number>> {
    const cutoff = (d: number) => new Date(now.getTime() - d * 86_400_000);
    const deleted: Record<string, number> = {};
    const purge = async (key: keyof typeof this.days, sql: string) => {
      if (this.days[key] === 0) return;
      const [, count] = (await this.ds.query(sql, [
        cutoff(this.days[key]),
      ])) as [unknown, number];
      deleted[key] = count;
    };

    await purge(
      'conversations',
      `DELETE FROM ai_conversations WHERE updated_at < $1`, // messages cascade
    );
    await purge('aiUsage', `DELETE FROM ai_usage WHERE created_at < $1`);
    await purge(
      'notifications',
      `DELETE FROM notification_log WHERE created_at < $1`,
    );
    if (this.days.audit > 0) {
      deleted.audit = await this.ds.transaction(async (em) => {
        await em.query(`SET LOCAL app.audit_purge = 'on'`);
        const [, count] = (await em.query(
          `DELETE FROM audit_logs WHERE created_at < $1`,
          [cutoff(this.days.audit)],
        )) as [unknown, number];
        return count;
      });
    }
    if (this.days.candidates > 0) {
      const stale: { id: string }[] = await this.ds.query(
        `SELECT c.id FROM candidates c
           JOIN applications a ON a.candidate_id = c.id
          GROUP BY c.id
         HAVING bool_and(a.status IN ('REJECTED', 'WITHDRAWN'))
            AND max(a.updated_at) < $1`,
        [cutoff(this.days.candidates)],
      );
      for (const c of stale) await this.privacy.eraseCandidate(c.id);
      deleted.candidates = stale.length;
    }

    this.logger.log({ deleted, days: this.days }, 'retention run');
    return deleted;
  }
}
