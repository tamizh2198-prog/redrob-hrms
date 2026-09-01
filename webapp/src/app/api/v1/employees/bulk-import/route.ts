import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateEmployeeDto } from "@/server/modules/employee/dto";
import * as employeeService from "@/server/modules/employee/service";

export const POST = withRoute<{ rows: CreateEmployeeDto[]; dryRun?: boolean }>(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] },
  async ({ user, body }) => {
    const result = await employeeService.bulkImport(prisma, body.rows, body.dryRun ?? true, user!.userId);
    return Response.json(result);
  },
);
