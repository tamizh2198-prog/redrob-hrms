import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as employeeService from "@/server/modules/employee/service";

export const GET = withRoute({}, async ({ user }) => {
  const result = await employeeService.getMyDepartmentColleagues(prisma, user!.userId);
  return Response.json(result);
});
