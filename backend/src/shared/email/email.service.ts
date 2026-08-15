import { Injectable, Logger } from '@nestjs/common';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface SendEmailResult {
  sent: boolean;
}

const RESEND_API_URL = 'https://api.resend.com/emails';

// Auth Phase 2: NotificationService.send() only logs (Section 7.16 is not
// built yet) — this is the minimum real email-sending abstraction the
// invitation flow needs, kept separate rather than changing
// NotificationService, which every other module already depends on.
//
// Sends via Resend's HTTPS API, not SMTP: Railway blocks outbound SMTP
// (ports 25/465/587) below its Pro plan, so nodemailer connections to
// smtp.gmail.com silently timed out in production even with correct
// credentials — confirmed by testing raw TCP connectivity from inside the
// deployed container (HTTPS/443 reached the internet fine, SMTP ports
// didn't). Resend's API runs over HTTPS/443, which Railway does allow.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string | null;
  private readonly from: string;

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY ?? null;
    this.from = process.env.EMAIL_FROM ?? 'no-reply@redrob.local';

    if (!this.apiKey) {
      this.logger.warn(
        'RESEND_API_KEY is not set — emails will be logged, not sent. Set this env var to enable real delivery.',
      );
    }
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (!this.apiKey) {
      // Dev-only fallback: log the full body (not just the subject) so a
      // local run without an API key configured can still recover the
      // invitation link from the console instead of the email being
      // silently lost.
      this.logger.log(
        `[email not configured] Would send to ${input.to}: "${input.subject}"\n${input.text}`,
      );
      return { sent: false };
    }

    try {
      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: input.to,
          subject: input.subject,
          text: input.text,
        }),
        // A blocked/unreachable egress path (the same class of failure
        // that motivated moving off SMTP) must still fail fast rather than
        // hang the caller — send() is awaited inline by employee creation/
        // invite/resend, so an unbounded hang would block the whole HTTP
        // request.
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Resend API responded ${response.status}: ${body}`);
      }

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
