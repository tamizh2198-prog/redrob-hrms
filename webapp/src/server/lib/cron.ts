import type { NextRequest } from "next/server";
import { HttpError } from "./errors";

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
  return authHeader === `Bearer ${secret}`;
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
