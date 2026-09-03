// Runs once per cold start via its side-effect import in prisma.ts (imported
// by virtually every route) — previously, a missing secret only surfaced the
// first time some specific code path actually needed it (JWT_ACCESS_SECRET
// throws on first login attempt; CRON_SECRET fails cron jobs silently
// forever; RESEND_API_KEY falls back to a console.log no-op with no signal
// at all). This surfaces a real misconfiguration immediately in production
// instead of waiting for a user or a cron job to trip over it.
//
// HRMS-17b fix: CRON_SECRET and FRONTEND_URL used to only warn, but both
// fail silently rather than merely degrading — a missing CRON_SECRET makes
// withCron() 401 all eleven scheduled jobs with no other symptom, and a
// missing FRONTEND_URL ships every invitation/activation/reset email with a
// localhost link. Promoted both to required so a misconfigured production
// deploy fails to boot instead of failing silently later. RESEND_API_KEY
// stays a warning — sendEmail() has a real (now production-gated, see
// email.ts) dev fallback rather than a silent failure mode.
const REQUIRED_IN_PRODUCTION = ["JWT_ACCESS_SECRET", "DATABASE_URL", "PII_ENCRYPTION_KEY", "CRON_SECRET", "FRONTEND_URL"];
const WARN_IF_MISSING_IN_PRODUCTION = ["RESEND_API_KEY"];

if (process.env.NODE_ENV === "production") {
  for (const key of REQUIRED_IN_PRODUCTION) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  for (const key of WARN_IF_MISSING_IN_PRODUCTION) {
    if (!process.env[key]) {
      console.error(`WARNING: ${key} is not set in production — related features will silently degrade.`);
    }
  }
}

export {};
