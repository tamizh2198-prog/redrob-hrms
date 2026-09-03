import type { PrismaClient } from "@prisma/client";
import { TooManyRequestsError } from "./errors";

export interface RateLimitOptions {
  max: number;
  windowMs: number;
}

// DB-backed rate limiter — no Redis/Upstash anywhere in this stack, so
// counting RateLimitAttempt rows newer than the window against Postgres
// (already the source of truth for everything else here) does the job.
// Callers decide what counts as "an attempt" — e.g. login/MFA only record on
// failure, but password-reset-request and public candidate-creation record
// on every call regardless of outcome, since even a "successful" request can
// be abused (email-bombing, spam submissions).
export async function enforceRateLimit(prisma: PrismaClient, key: string, options: RateLimitOptions): Promise<void> {
  const since = new Date(Date.now() - options.windowMs);
  const count = await prisma.rateLimitAttempt.count({ where: { key, createdAt: { gte: since } } });
  if (count >= options.max) {
    throw new TooManyRequestsError();
  }
}

export async function recordRateLimitAttempt(prisma: PrismaClient, key: string): Promise<void> {
  await prisma.rateLimitAttempt.create({ data: { key } });
}
