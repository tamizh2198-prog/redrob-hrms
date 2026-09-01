import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as employeeService from "@/server/modules/employee/service";

export const POST = withRoute<{ reason?: string }>(
  { roles: ["HR_ADMIN", "SUPER_ADMIN"] },
  async ({ user, params, body }) => {
    await employeeService.rejectChangeRequest(prisma, params.id, user!.userId, body?.reason);
    return new Response(null, { status: 200 });
  },
);
