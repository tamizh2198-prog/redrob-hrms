export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: string /* base64 */ }[];
}

export interface SendEmailResult {
  sent: boolean;
}

const RESEND_API_URL = "https://api.resend.com/emails";

// Sends via Resend's HTTPS API, not SMTP — see backend/src/shared/email/email.service.ts
// for why (Railway blocked outbound SMTP; kept as-is since Vercel has the same class
// of restriction on arbitrary outbound TCP ports).
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "no-reply@redrob.local";

  if (!apiKey) {
    // HRMS-17b: this fallback is a genuine dev convenience (recover an
    // invitation/reset link from the console when no API key is
    // configured locally) but is gated on NODE_ENV rather than merely on
    // the key's absence — RESEND_API_KEY is only a WARN_IF_MISSING var
    // (see env-check.ts), so a misconfigured production deploy missing it
    // must not start writing full invitation and reset links, a live
    // credential, to the production server log.
    if (process.env.NODE_ENV === "production") {
      console.error(`RESEND_API_KEY is not set — email to ${input.to} ("${input.subject}") was not sent.`);
      return { sent: false };
    }
    const attachmentNote = input.attachments?.length ? ` (with ${input.attachments.length} attachment(s))` : "";
    console.log(`[email not configured] Would send to ${input.to}${attachmentNote}: "${input.subject}"\n${input.text}`);
    return { sent: false };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.attachments ? { attachments: input.attachments } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Resend API responded ${response.status}: ${body}`);
    }

    return { sent: true };
  } catch (err) {
    console.error(`Failed to send email to ${input.to}:`, err instanceof Error ? err.message : err);
    return { sent: false };
  }
}
