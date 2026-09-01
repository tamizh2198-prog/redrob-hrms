import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { UpdateEmployeeDto } from "@/server/modules/employee/dto";
import * as employeeService from "@/server/modules/employee/service";

export const GET = withRoute({}, async ({ user, params }) => {
  const result = await employeeService.findOne(prisma, params.id, { userId: user?.userId, role: user?.role });
  return Response.json(result);
});

export const PATCH = withRoute({ dto: UpdateEmployeeDto }, async ({ user, params, body }) => {
  const result = await employeeService.update(prisma, params.id, body, { userId: user?.userId, role: user?.role });
  return Response.json(result);
});

// Permanent removal, for test/development cleanup only — SUPER_ADMIN-gated,
// separate from and does not alter dismiss (soft terminate).
export const DELETE = withRoute({ roles: ["SUPER_ADMIN"] }, async ({ params }) => {
  const result = await employeeService.deleteEmployee(prisma, params.id);
  return Response.json(result);
});
