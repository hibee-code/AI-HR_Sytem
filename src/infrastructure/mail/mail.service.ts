import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import * as nodemailer from 'nodemailer';
import type { Env } from '../../config/env.schema';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  messageId: string;
}

/**
 * Thin SMTP adapter. In `test` it uses nodemailer's JSON transport so no
 * socket is ever opened; in dev the compose stack's Mailpit catches mail.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly transport: nodemailer.Transporter;
  private readonly from: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: Logger,
  ) {
    this.from = config.get('MAIL_FROM', { infer: true });
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASSWORD', { infer: true });

    this.transport =
      config.get('NODE_ENV', { infer: true }) === 'test'
        ? nodemailer.createTransport({ jsonTransport: true })
        : nodemailer.createTransport({
            host: config.get('SMTP_HOST', { infer: true }),
            port: config.get('SMTP_PORT', { infer: true }),
            secure: config.get('SMTP_SECURE', { infer: true }),
            auth: user ? { user, pass } : undefined,
            pool: true,
            maxConnections: 3,
          });
  }

  async send(message: MailMessage): Promise<MailResult> {
    const info = await this.transport.sendMail({ from: this.from, ...message });
    this.logger.debug(
      { to: message.to, messageId: info.messageId },
      'mail sent',
    );
    return { messageId: info.messageId };
  }

  /** Used by the readiness probe in a later stage; cheap SMTP handshake. */
  verify(): Promise<true> {
    return this.transport.verify();
  }

  onModuleDestroy(): void {
    this.transport.close();
  }
}
