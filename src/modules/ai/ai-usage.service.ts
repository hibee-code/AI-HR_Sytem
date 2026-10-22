import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { MoreThanOrEqual, Repository } from 'typeorm';
import type { Env } from '../../config/env.schema';
import type { ChatResponse } from '../../infrastructure/ai/chat-model.interface';
import { estimateCostUsd } from '../../infrastructure/ai/pricing';
import { AiFeature, AiUsage } from './entities/ai-usage.entity';

export interface UsageSummaryRow {
  day: string;
  feature: string;
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

/** Records every model call and enforces the per-user daily assistant cap. */
@Injectable()
export class AiUsageService {
  private readonly dailyLimit: number;

  constructor(
    @InjectRepository(AiUsage) private readonly usage: Repository<AiUsage>,
    private readonly logger: Logger,
    config: ConfigService<Env, true>,
  ) {
    this.dailyLimit = config.get('AI_DAILY_MESSAGE_LIMIT', { infer: true });
  }

  /** Never throws — accounting must not fail the answer the user already got. */
  async record(
    res: Pick<ChatResponse, 'provider' | 'model' | 'usage'>,
    ctx: { feature: AiFeature; userId: string | null },
  ): Promise<void> {
    const costUsd = estimateCostUsd(res.model, res.usage);
    const row = {
      userId: ctx.userId,
      feature: ctx.feature,
      provider: res.provider,
      model: res.model.slice(0, 100),
      inputTokens: res.usage?.inputTokens ?? 0,
      outputTokens: res.usage?.outputTokens ?? 0,
      costUsd,
    };
    this.logger.log({ ...row }, 'ai call');
    try {
      await this.usage.save(this.usage.create(row));
    } catch (err) {
      this.logger.error(
        { err: (err as Error).message },
        'ai usage write failed',
      );
    }
  }

  /** Model calls the user has made today (UTC) and the cap (0 = unlimited). */
  async today(userId: string): Promise<{ used: number; limit: number }> {
    const used = await this.usage.count({
      where: {
        userId,
        feature: AiFeature.ASSISTANT,
        createdAt: MoreThanOrEqual(startOfUtcDay()),
      },
    });
    return { used, limit: this.dailyLimit };
  }

  async assertWithinDailyLimit(userId: string): Promise<void> {
    if (this.dailyLimit === 0) return;
    const { used, limit } = await this.today(userId);
    if (used >= limit) {
      throw new HttpException(
        {
          error: 'AI_DAILY_LIMIT',
          message: `You've reached today's limit of ${limit} assistant questions. It resets at 00:00 UTC.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Per day / feature / model totals for the reporting endpoint. */
  async summary(from: Date, to: Date): Promise<UsageSummaryRow[]> {
    const rows: Record<string, string | null>[] = await this.usage.query(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
              feature, provider, model,
              COUNT(*) AS calls,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cost_usd) AS cost_usd
         FROM ai_usage
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1, 2, 3, 4
        ORDER BY 1 DESC, 2, 3, 4`,
      [from, to],
    );
    return rows.map((r) => ({
      day: r.day!,
      feature: r.feature!,
      provider: r.provider!,
      model: r.model!,
      calls: Number(r.calls),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
    }));
  }
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
