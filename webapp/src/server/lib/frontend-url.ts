// Every invitation/reset/offer/preboarding link is built from this. HRMS-17b:
// used to fall back to localhost silently at all 5 call sites, which just
// means a misconfigured production deploy emails dead links with no signal
// anywhere that anything's wrong. FRONTEND_URL is now in env-check.ts's
// REQUIRED_IN_PRODUCTION, so production fails to boot rather than serving
// broken links — this throws too (same shape as JWT_ACCESS_SECRET in
// auth.ts) as a second line of defense for any environment that skips
// env-check but still calls this, local dev/test included, matching every
// other required secret's runtime behavior in this codebase.
export function getFrontendUrl(): string {
  const url = process.env.FRONTEND_URL;
  if (!url) throw new Error("FRONTEND_URL must be set");
  return url;
}
