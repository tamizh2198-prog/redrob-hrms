import { createHash } from "crypto";

// TEMPORARY diagnostic route — reveals only a truncated SHA-256 fingerprint
// of the currently-loaded PII_ENCRYPTION_KEY (never the key itself), so we
// can confirm which key value a live deployment actually has without
// exposing any secret. Remove once the production key-mismatch incident is
// resolved.
export async function GET() {
  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw) return Response.json({ set: false });
  const fingerprint = createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return Response.json({ set: true, length: raw.length, fingerprint });
}
