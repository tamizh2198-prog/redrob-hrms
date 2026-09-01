import { randomBytes, createHash } from "crypto";

// Auth Phase 2: raw token goes into the email link and is never persisted;
// only its SHA-256 hash is stored, so a database read alone can't be used
// to activate an account.
export function generateInvitationToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashInvitationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
