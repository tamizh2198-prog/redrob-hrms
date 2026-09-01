import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as employeeService from "@/server/modules/employee/service";

// SUPER_ADMIN only. Never hard-deletes; sets the existing TERMINATED status.
export const POST = withRoute({ roles: ["SUPER_ADMIN"] }, async ({ user, params }) => {
  const result = await employeeService.dismissEmployee(prisma, params.id, user!.userId);
  return Response.json(result);
});
