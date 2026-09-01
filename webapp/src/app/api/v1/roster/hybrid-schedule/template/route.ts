import { withRoute } from "@/server/lib/route";
import { buildHybridScheduleTemplate } from "@/server/modules/shift/hybrid-schedule-upload";

export const GET = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], module: "SHIFT" }, async () => {
  const buffer = await buildHybridScheduleTemplate();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="wfo-days-template.xlsx"',
    },
  });
});
