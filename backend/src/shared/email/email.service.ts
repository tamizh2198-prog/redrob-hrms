import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as dns from 'dns';
import * as net from 'net';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface SendEmailResult {
  sent: boolean;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

// Auth Phase 2: NotificationService.send() only logs (Section 7.16 is not
// built yet) — this is the minimum real email-sending abstraction the
// invitation flow needs, kept separate rather than changing
// NotificationService, which every other module already depends on.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly config: SmtpConfig | null;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    this.from = process.env.SMTP_FROM ?? 'no-reply@redrob.local';

    if (host && port && user && pass) {
      this.config = { host, port: Number(port), user, pass };
    } else {
      this.config = null;
      this.logger.warn(
        'SMTP is not configured (SMTP_HOST/PORT/USER/PASS) — emails will be logged, not sent. Set these env vars to enable real delivery.',
      );
    }
  }

  // Production fix: nodemailer resolves both the A and AAAA records for the
  // SMTP host and picks one at random (see lib/shared/index.js in the
  // nodemailer package) rather than preferring IPv4. On hosts without
  // outbound IPv6 routing (e.g. Railway), landing on the AAAA record fails
  // with ENETUNREACH. Resolving to an IPv4 address ourselves and connecting
  // to that IP directly avoids the random pick; passing the original
  // hostname as `servername` keeps TLS SNI and certificate validation
  // exactly as before. If the lookup fails for any reason, fall back to
  // nodemailer's default hostname-based connection so non-Gmail SMTP hosts
  // (or IPv6-only ones) are unaffected.
  private async createTransporter(config: SmtpConfig): Promise<nodemailer.Transporter> {
    let connectHost = config.host;
    let servername: string | undefined;

    if (!net.isIP(config.host)) {
      try {
        const [ipv4] = await dns.promises.resolve4(config.host);
        if (ipv4) {
          connectHost = ipv4;
          servername = config.host;
        }
      } catch (err) {
        this.logger.warn(
          `Could not resolve an IPv4 address for SMTP host ${config.host}, falling back to default DNS resolution: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      }
    }

    return nodemailer.createTransport({
      host: connectHost,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass },
      ...(servername ? { servername } : {}),
    });
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (!this.config) {
      // Dev-only fallback: log the full body (not just the subject) so a
      // local run without SMTP configured can still recover the invitation
      // link from the console instead of the email being silently lost.
      this.logger.log(
        `[email not configured] Would send to ${input.to}: "${input.subject}"\n${input.text}`,
      );
      return { sent: false };
    }

    try {
      const transporter = await this.createTransporter(this.config);
      await transporter.sendMail({
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
