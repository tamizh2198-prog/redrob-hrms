import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Field-level encryption at rest for PAN/Aadhaar/bank account number/IFSC
// code. AES-256-GCM (authenticated — tampering is detected, not just
// undetected corruption), a random IV per value, packed into a single
// string so the column shape (`String?`) doesn't need to change:
//   v1:<iv-base64>:<authTag-base64>:<ciphertext-base64>

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const VERSION_PREFIX = "v1";
const KEY_BYTES = 32; // AES-256

let cachedKey: Buffer | undefined;

// Fail loudly if unset/malformed, rather than silently encrypting against a
// wrong-length key or crashing deep inside a request — mirrors auth.ts's
// getAccessSecret().
function getPiiEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw) throw new Error("PII_ENCRYPTION_KEY must be set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`PII_ENCRYPTION_KEY must decode (base64) to exactly ${KEY_BYTES} bytes — got ${key.length}`);
  }
  cachedKey = key;
  return key;
}

function looksEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION_PREFIX}:`);
}

/** Used by the backfill script to skip rows already migrated. */
export function isEncryptedPiiValue(value: string | null | undefined): boolean {
  return typeof value === "string" && looksEncrypted(value);
}

export function encryptPii(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getPiiEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION_PREFIX, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    ":",
  );
}

export function decryptPii(value: string): string {
  if (!looksEncrypted(value)) {
    // Legacy plaintext row the backfill script hasn't reached yet (or a row
    // read during the rollout window before it ran) — return as-is rather
    // than throw, so reads never crash on a straggler. Kept permanently,
    // not just during rollout: a near-zero-cost safety net.
    return value;
  }
  const [, ivB64, tagB64, dataB64] = value.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted PII value");
  const decipher = createDecipheriv(ALGORITHM, getPiiEncryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  // Wrong key or a tampered ciphertext/tag throws here (GCM auth failure) —
  // deliberately not caught.
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

export function encryptPiiNullable(value: string | null | undefined): string | null | undefined {
  return value === null || value === undefined || value === "" ? value : encryptPii(value);
}

export function decryptPiiNullable(value: string | null | undefined): string | null | undefined {
  return value === null || value === undefined || value === "" ? value : decryptPii(value);
}
