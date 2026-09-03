import type { NextRequest } from "next/server";

// Vercel sets x-forwarded-for on every request; this is best-effort (a
// client could spoof it if not behind Vercel's edge, but on Vercel the
// platform itself appends the real connecting IP as the last entry) — used
// only as a rate-limit key, not for any access-control decision.
export function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor.split(",").map((p) => p.trim());
    return parts[parts.length - 1] || "unknown";
  }
  return "unknown";
}
