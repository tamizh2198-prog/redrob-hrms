import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as settingsService from "@/server/modules/settings/service";

export const GET = withRoute({ roles: ["SUPER_ADMIN"] }, async () => {
  const backup = await settingsService.exportBackup(prisma);
  const buffer = Buffer.from(JSON.stringify(backup), "utf-8");
  const timestamp = backup.createdAt.replace(/[:.]/g, "-");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="redrob-hrms-backup-${timestamp}.json"`,
    },
  });
});
