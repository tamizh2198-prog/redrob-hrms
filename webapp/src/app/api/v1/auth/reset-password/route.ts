import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { ConsumePasswordResetDto } from "@/server/modules/auth/dto";
import * as employeeService from "@/server/modules/employee/service";

export const POST = withRoute({ public: true, dto: ConsumePasswordResetDto }, async ({ body }) => {
  const result = await employeeService.consumePasswordReset(prisma, body);
  return Response.json(result);
});
