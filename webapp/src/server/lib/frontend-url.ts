// Every invitation/reset/offer/preboarding link is built from this. Falling
// back to localhost silently (the previous behavior at all 5 call sites)
// means a misconfigured production deploy just emails dead links with no
// signal anywhere that anything's wrong — this at least logs loudly so it
// shows up in Vercel's function logs immediately.
export function getFrontendUrl(): string {
  const url = process.env.FRONTEND_URL;
  if (!url) {
    console.error("FRONTEND_URL is not set — falling back to http://localhost:3000. Links in emails will be broken outside local dev.");
    return "http://localhost:3000";
  }
  return url;
}
