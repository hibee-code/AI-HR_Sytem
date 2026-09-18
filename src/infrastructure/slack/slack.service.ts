import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';
import { Logger } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';

export interface SlackMessage {
  /** A Slack user id (DM) or channel name/id. */
  channel: string;
  text: string;
  /** Optional Block Kit payload; `text` is still used as the notification fallback. */
  blocks?: unknown[];
}

/**
 * Slack bot adapter. Requires a bot token with `chat:write`,
 * `users:read.email` (for DM-by-email) and `im:write`. When no token is
 * configured, `isConfigured` is false and callers should skip Slack.
 */
@Injectable()
export class SlackService {
  private readonly client: WebClient | null;
  readonly defaultChannel: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: Logger,
  ) {
    const token = config.get('SLACK_BOT_TOKEN', { infer: true });
    this.client = token ? new WebClient(token) : null;
    this.defaultChannel = config.get('SLACK_DEFAULT_CHANNEL', { infer: true });
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  async post(message: SlackMessage): Promise<{ ts: string }> {
    const res = await this.requireClient().chat.postMessage({
      channel: message.channel,
      text: message.text,
      blocks: message.blocks as never,
    });
    this.logger.debug(
      { channel: message.channel, ts: res.ts },
      'slack message posted',
    );
    return { ts: res.ts ?? '' };
  }

  /** Resolves a workspace member's Slack id from their email, or null if not found. */
  async lookupUserIdByEmail(email: string): Promise<string | null> {
    try {
      const res = await this.requireClient().users.lookupByEmail({ email });
      return res.user?.id ?? null;
    } catch (err) {
      if (
        (err as { data?: { error?: string } }).data?.error === 'users_not_found'
      )
        return null;
      throw err;
    }
  }

  private requireClient(): WebClient {
    if (!this.client)
      throw new Error('Slack is not configured (SLACK_BOT_TOKEN missing)');
    return this.client;
  }
}
