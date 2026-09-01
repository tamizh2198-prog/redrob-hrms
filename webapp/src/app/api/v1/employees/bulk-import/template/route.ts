import { withRoute } from "@/server/lib/route";
import { buildEmployeeImportTemplate } from "@/server/modules/employee/bulk-import-upload";

// Blank starter workbook (same fields as the JSON-paste bulk-import above,
// laid out as spreadsheet columns) plus a Reference sheet of accepted enum
// values.
export const GET = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async () => {
  const buffer = await buildEmployeeImportTemplate();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="employee-bulk-import-template.xlsx"',
    },
  });
});
