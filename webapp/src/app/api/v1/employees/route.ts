import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateEmployeeDto, ListEmployeesQueryDto } from "@/server/modules/employee/dto";
import * as employeeService from "@/server/modules/employee/service";

export const GET = withRoute({ query: ListEmployeesQueryDto }, async ({ user, query }) => {
  const result = await employeeService.findAll(prisma, query, { userId: user?.userId, role: user?.role });
  return Response.json(result);
});

export const POST = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: CreateEmployeeDto },
  async ({ user, body }) => {
    const result = await employeeService.create(prisma, body, user!.userId);
    return Response.json(result);
  },
);
