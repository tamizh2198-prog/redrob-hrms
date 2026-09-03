import { createHash } from "crypto";
import { prisma } from "@/server/lib/prisma";
import { decryptPii, isEncryptedPiiValue } from "@/server/lib/pii-crypto";

// TEMPORARY diagnostic route — reveals only a truncated SHA-256 fingerprint
// of the currently-loaded PII_ENCRYPTION_KEY (never the key itself) and a
// per-row decrypt health check against whatever database this deployment is
// actually connected to (employee codes + which fields fail, never the
// values themselves). Remove once the production key-mismatch incident is
// resolved.
export async function GET() {
  const raw = process.env.PII_ENCRYPTION_KEY;
  const keyInfo = raw
    ? { set: true, length: raw.length, fingerprint: createHash("sha256").update(raw).digest("hex").slice(0, 12) }
    : { set: false };

  const dbUrl = process.env.DATABASE_URL ?? "";
  const dbHostMatch = /@([^/:]+)/.exec(dbUrl);
  const dbFingerprint = createHash("sha256").update(dbUrl).digest("hex").slice(0, 12);

  const employees = await prisma.employee.findMany({
    select: { employeeCode: true, pan: true, aadhaar: true, bankAccountNumber: true, ifscCode: true },
  });

  const rows = employees.map((e) => {
    const fields: Record<string, string> = {};
    for (const [field, value] of Object.entries({
      pan: e.pan,
      aadhaar: e.aadhaar,
      bankAccountNumber: e.bankAccountNumber,
      ifscCode: e.ifscCode,
    })) {
      if (!value) continue;
      if (!isEncryptedPiiValue(value)) {
        fields[field] = "plaintext";
        continue;
      }
      try {
        decryptPii(value);
        fields[field] = "ok";
      } catch {
        fields[field] = "DECRYPT_FAILED";
      }
    }
    return { employeeCode: e.employeeCode, fields };
  });

  return Response.json({
    key: keyInfo,
    db: { host: dbHostMatch?.[1] ?? "unknown", fingerprint: dbFingerprint },
    employeeCount: employees.length,
    rows,
  });
}
