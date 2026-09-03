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

// HRMS-20 fix: rows were only ever inserted, never pruned. The public
// candidate-creation endpoint in particular is an unauthenticated write
// path whose only remaining cost to an abuser was a permanent row here, so
// sustained abuse translated directly into unbounded table growth. 24h is a
// fixed retention window rather than "the longest configured windowMs"
// looked up dynamically, because those live scattered across several
// modules (auth, employee, ats) — a fixed cutoff comfortably longer than
// today's longest window (1h) avoids this job silently under-retaining if
// a future caller configures a longer one and forgets to update this file.
const RETENTION_MS = 24 * 60 * 60 * 1000;

export async function pruneRateLimitAttempts(prisma: PrismaClient): Promise<{ deletedCount: number }> {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const { count } = await prisma.rateLimitAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { deletedCount: count };
}
