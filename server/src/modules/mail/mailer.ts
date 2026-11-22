import nodemailer from 'nodemailer';
import type { AppConfig } from '../../config/env.js';
import type { Logger } from '../../lib/logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  /** True when real delivery (SMTP) is configured. */
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
  /** Messages captured when SMTP is not configured outside production (for local development and tests). */
  readonly outbox: MailMessage[];
}

/**
 * Sends email through SMTP when SMTP_URL is set. Without it:
 *  - development / test: the message (including its link) is logged and kept in `outbox`, so the flows still work;
 *  - production: nothing is sent and an error is logged — links are secrets and must never land in logs.
 */
export function createMailer(cfg: AppConfig, log: Logger): Mailer {
  const outbox: MailMessage[] = [];
  if (cfg.mail.smtpUrl) {
    const transport = nodemailer.createTransport(cfg.mail.smtpUrl);
    return {
      configured: true,
      outbox,
      async send(m) {
        await transport.sendMail({ from: cfg.mail.from, to: m.to, subject: m.subject, text: m.text });
        log.info({ to: m.to, subject: m.subject }, 'email sent');
      }
    };
  }
  return {
    configured: false,
    outbox,
    async send(m) {
      if (cfg.env === 'production') {
        log.error({ to: m.to, subject: m.subject }, 'email not sent: SMTP_URL is not configured');
        return;
      }
      outbox.push(m);
      if (outbox.length > 50) outbox.shift();
      log.info({ to: m.to, subject: m.subject, text: m.text }, 'email (not sent: SMTP_URL not configured; development copy)');
    }
  };
}
