import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as employeeService from "@/server/modules/employee/service";

export const POST = withRoute({ roles: ["HR_ADMIN", "SUPER_ADMIN"] }, async ({ user, params }) => {
  await employeeService.approveChangeRequest(prisma, params.id, user!.userId);
  return new Response(null, { status: 200 });
});
