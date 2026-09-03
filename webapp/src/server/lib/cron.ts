import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { HttpError } from "./errors";

// SHA-256 both sides first, then compare with timingSafeEqual — hashing
// upfront means both buffers are always the same length (32 bytes), so this
// never leaks the real secret's length via how quickly a mismatch is
// rejected, on top of the timing-safe comparison itself.
function constantTimeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

// Replaces NestJS's @Cron(...) decorator + ScheduleModule.forRoot() — there
// is no in-process scheduler in a Next.js deployment, so each job becomes an
// HTTP-triggered Route Handler instead, protected by a shared secret so it
// can't be triggered publicly. Vercel Cron sends `Authorization: Bearer
// <CRON_SECRET>` automatically when the CRON_SECRET env var is set; any
// other trigger source (e.g. Supabase pg_cron, cron-job.org) must be
// configured to send the same header.
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;
  return constantTimeEqual(authHeader, `Bearer ${secret}`);
}

export function withCron(handler: () => Promise<Response>) {
  return async (req: NextRequest): Promise<Response> => {
    if (!isAuthorized(req)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    try {
      return await handler();
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Internal server error";
      if (!(error instanceof HttpError)) {
        console.error("Cron job failed:", error);
      }
      return Response.json({ message }, { status });
    }
  };
}
