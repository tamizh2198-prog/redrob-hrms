export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
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
    // Dev-only fallback: log the full body so a local run without an API key
    // configured can still recover the invitation link from the console.
    console.log(`[email not configured] Would send to ${input.to}: "${input.subject}"\n${input.text}`);
    return { sent: false };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: input.to, subject: input.subject, text: input.text }),
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
