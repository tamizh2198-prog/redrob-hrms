import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { PlaceOnPipDto } from "@/server/modules/employee/dto";
import * as employeeService from "@/server/modules/employee/service";

// SUPER_ADMIN only. Non-terminal — employee stays active (see ACTIVE_STATUSES).
export const POST = withRoute({ roles: ["SUPER_ADMIN"], dto: PlaceOnPipDto }, async ({ user, params, body }) => {
  const result = await employeeService.placeOnPip(prisma, params.id, user!.userId, body.reason);
  return Response.json(result);
});
