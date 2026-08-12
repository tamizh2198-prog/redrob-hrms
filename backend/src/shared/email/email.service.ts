import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface SendEmailResult {
  sent: boolean;
}

// Auth Phase 2: NotificationService.send() only logs (Section 7.16 is not
// built yet) — this is the minimum real email-sending abstraction the
// invitation flow needs, kept separate rather than changing
// NotificationService, which every other module already depends on.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    this.from = process.env.SMTP_FROM ?? 'no-reply@redrob.local';

    if (host && port && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(port),
        secure: Number(port) === 465,
        auth: { user, pass },
      });
    } else {
      this.transporter = null;
      this.logger.warn(
        'SMTP is not configured (SMTP_HOST/PORT/USER/PASS) — emails will be logged, not sent. Set these env vars to enable real delivery.',
      );
    }
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (!this.transporter) {
      // Dev-only fallback: log the full body (not just the subject) so a
      // local run without SMTP configured can still recover the invitation
      // link from the console instead of the email being silently lost.
      this.logger.log(
        `[email not configured] Would send to ${input.to}: "${input.subject}"\n${input.text}`,
      );
      return { sent: false };
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
      return { sent: true };
    } catch (err) {
      // Never throw on delivery failure — the caller (employee creation)
      // must still succeed; see Phase 2 "email failure behavior" rule.
      this.logger.error(
        `Failed to send email to ${input.to}: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      return { sent: false };
    }
  }
}
