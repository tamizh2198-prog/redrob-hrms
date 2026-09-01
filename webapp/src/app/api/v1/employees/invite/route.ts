import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { InviteEmployeeDto } from "@/server/modules/employee/dto";
import * as employeeService from "@/server/modules/employee/service";

export const POST = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: InviteEmployeeDto },
  async ({ user, body }) => {
    const result = await employeeService.inviteEmployee(prisma, body, user!.userId, user!.role);
    return Response.json(result);
  },
);
