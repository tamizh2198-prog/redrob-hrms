import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { UpdateMyProfileDto } from "@/server/modules/employee/dto";
import * as employeeService from "@/server/modules/employee/service";

// Auth Phase 3: employeeId always comes from the JWT — never from a param
// or body — so this can only ever act on the caller's own record. No role
// gate: any authenticated employee may read/edit their own profile.
export const GET = withRoute({}, async ({ user }) => {
  const result = await employeeService.getMyProfile(prisma, user!.userId);
  return Response.json(result);
});

export const PATCH = withRoute({ dto: UpdateMyProfileDto }, async ({ user, body }) => {
  const result = await employeeService.updateMyProfile(prisma, user!.userId, body);
  return Response.json(result);
});
