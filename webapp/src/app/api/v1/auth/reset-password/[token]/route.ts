import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as employeeService from "@/server/modules/employee/service";

export const GET = withRoute({ public: true }, async ({ params }) => {
  const result = await employeeService.validatePasswordResetToken(prisma, params.token);
  return Response.json(result);
});
