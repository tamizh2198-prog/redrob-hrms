import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { recordAuditLog } from "@/server/lib/audit";
import * as settingsService from "@/server/modules/settings/service";

// withRoute only auto-audits state-changing methods (POST/PUT/PATCH/DELETE)
// — this is a GET, so a full unencrypted export of every table (including
// passwordHash/mfaSecret/Aadhaar/PAN) previously left no trace anywhere.
// Logged explicitly here instead; the payload itself is deliberately not
// logged (it's the exact data this endpoint exists to guard).
export const GET = withRoute({ roles: ["SUPER_ADMIN"] }, async ({ user }) => {
  const backup = await settingsService.exportBackup(prisma);
  await recordAuditLog(prisma, {
    actorId: user!.userId,
    actorRole: user!.role,
    method: "GET",
    path: "/api/v1/settings/backup",
    statusCode: 200,
    requestBody: undefined,
    responseBody: { note: "[full backup export — payload not logged]" },
  });

  const buffer = Buffer.from(JSON.stringify(backup), "utf-8");
  const timestamp = backup.createdAt.replace(/[:.]/g, "-");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="redrob-hrms-backup-${timestamp}.json"`,
    },
  });
});
