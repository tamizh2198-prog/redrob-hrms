import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as employeeService from "@/server/modules/employee/service";

// Base @Roles gate here is deliberately broader than the actual
// authorization — assertCanResetCredentials (inside resetPassword) enforces
// that only a Super Admin can reset an HR Admin's/Super Admin's own
// credentials, so an HR Admin reaching this route for a peer/superior still
// gets rejected, just by the service rather than the guard.
export const POST = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async ({ user, params }) => {
  const result = await employeeService.resetPassword(prisma, params.id, user!.userId, user!.role);
  return Response.json(result);
});
