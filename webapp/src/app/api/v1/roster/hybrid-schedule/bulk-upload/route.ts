import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { BadRequestError } from "@/server/lib/errors";
import { parseHybridScheduleWorkbook } from "@/server/modules/shift/hybrid-schedule-upload";
import * as shiftService from "@/server/modules/shift/service";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const POST = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], module: "SHIFT", rawBody: true },
  async ({ req }) => {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new BadRequestError("No file uploaded");
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestError("File too large");

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = await parseHybridScheduleWorkbook(buffer);
    if (rows.length === 0) {
      throw new BadRequestError("No data rows found — check the sheet matches the template columns (Employee Code, Year, Month, Sun..Sat)");
    }

    const dryRunRaw = req.nextUrl.searchParams.get("dryRun");
    const result = await shiftService.bulkSetHybridSchedule(prisma, rows, dryRunRaw === "true");
    return Response.json(result);
  },
);
