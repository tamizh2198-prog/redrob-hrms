import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as employeeService from "@/server/modules/employee/service";

// Super Admin-only Excel export of the active roster.
export const GET = withRoute({ roles: ["SUPER_ADMIN"] }, async () => {
  const buffer = await employeeService.exportActiveEmployees(prisma);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="active-employees.xlsx"',
    },
  });
});
