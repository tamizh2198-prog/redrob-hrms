import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { BadRequestError } from "@/server/lib/errors";
import { parseEmployeeImportWorkbook } from "@/server/modules/employee/bulk-import-upload";
import { CreateEmployeeDto } from "@/server/modules/employee/dto";
import * as employeeService from "@/server/modules/employee/service";

// Defense-in-depth against an oversized upload, not a real-world file size —
// an employee roster sheet is at most a few thousand rows.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Excel counterpart to POST bulk-import: same validate/dry-run/commit
// pipeline, just parsed from an uploaded .xlsx instead of a hand-pasted
// JSON array.
export const POST = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], rawBody: true }, async ({ req, user }) => {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new BadRequestError("No file uploaded");
  if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestError("File too large");

  const buffer = Buffer.from(await file.arrayBuffer());
  const rows = await parseEmployeeImportWorkbook(buffer);
  if (rows.length === 0) {
    throw new BadRequestError("No data rows found — check the sheet matches the template columns");
  }

  const dryRunRaw = req.nextUrl.searchParams.get("dryRun");
  const result = await employeeService.bulkImport(prisma, rows as CreateEmployeeDto[], dryRunRaw !== "false", user!.userId);
  return Response.json(result);
});
