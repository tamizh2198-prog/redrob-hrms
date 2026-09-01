import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as employeeService from "@/server/modules/employee/service";

export const POST = withRoute({}, async ({ user, params }) => {
  const result = await employeeService.revealSensitiveFields(prisma, params.id, { userId: user?.userId, role: user?.role });
  return Response.json(result);
});
