import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { ActivateAccountDto } from "@/server/modules/auth/dto";
import * as employeeService from "@/server/modules/employee/service";

export const POST = withRoute({ public: true, dto: ActivateAccountDto }, async ({ body }) => {
  const result = await employeeService.activateAccount(prisma, body);
  return Response.json(result);
});
