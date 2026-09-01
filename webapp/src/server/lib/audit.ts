import type { Prisma, PrismaClient } from "@prisma/client";
import { getOrCreateDefaultCompanyId } from "./default-company";

// Never persist credentials/secrets into a table HR Admins can browse —
// login/refresh bodies carry a password, and auth responses carry tokens.
const SENSITIVE_FIELD_PATTERN = /password|token|secret|pan|aadhaar|bankaccount/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_FIELD_PATTERN.test(key) ? "[REDACTED]" : redact(val);
  }
  return out;
}

// Strips the "/api/v1" prefix so `module` is just the feature's own path
// segment, e.g. "helpdesk" rather than "api".
function deriveModule(path: string): string {
  const segments = path.split("?")[0].split("/").filter(Boolean);
  const withoutPrefix =
    segments[0] === "api" && segments[1] === "v1" ? segments.slice(2) : segments;
  return withoutPrefix[0] ?? "unknown";
}

export interface AuditLogEntry {
  actorId?: string;
  actorRole?: string;
  method: string;
  path: string;
  statusCode?: number;
  requestBody?: unknown;
  responseBody?: unknown;
  /** Set when the response is a file download — its bytes are never logged. */
  isFileDownload?: boolean;
}

export async function recordAuditLog(prisma: PrismaClient, entry: AuditLogEntry): Promise<void> {
  const companyId = await getOrCreateDefaultCompanyId(prisma);
  await prisma.auditLog.create({
    data: {
      companyId,
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      method: entry.method,
      path: entry.path,
      module: deriveModule(entry.path),
      statusCode: entry.statusCode,
      requestBody: redact(entry.requestBody) as Prisma.InputJsonValue | undefined,
      responseBody: (entry.isFileDownload
        ? { note: "[file download — body not logged]" }
        : redact(entry.responseBody)) as Prisma.InputJsonValue | undefined,
    },
  });
}
