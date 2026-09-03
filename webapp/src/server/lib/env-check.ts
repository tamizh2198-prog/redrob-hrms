// Runs once per cold start via its side-effect import in prisma.ts (imported
// by virtually every route) — previously, a missing secret only surfaced the
// first time some specific code path actually needed it (JWT_ACCESS_SECRET
// throws on first login attempt; CRON_SECRET fails cron jobs silently
// forever; RESEND_API_KEY falls back to a console.log no-op with no signal
// at all). This surfaces a real misconfiguration immediately in production
// instead of waiting for a user or a cron job to trip over it.
const REQUIRED_IN_PRODUCTION = ["JWT_ACCESS_SECRET", "DATABASE_URL"];
const WARN_IF_MISSING_IN_PRODUCTION = ["RESEND_API_KEY", "CRON_SECRET", "FRONTEND_URL"];

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
