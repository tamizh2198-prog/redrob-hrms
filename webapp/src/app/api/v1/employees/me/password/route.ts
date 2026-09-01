import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { ChangePasswordDto } from "@/server/modules/employee/dto";
import * as employeeService from "@/server/modules/employee/service";

export const PATCH = withRoute({ dto: ChangePasswordDto }, async ({ user, body }) => {
  const result = await employeeService.changeMyPassword(prisma, user!.userId, body);
  return Response.json(result);
});
