import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as employeeService from "@/server/modules/employee/service";

// Auth Phase 2: the invitation token itself is the authorization mechanism
// — deliberately public, since the employee has no account/JWT yet.
export const GET = withRoute({ public: true }, async ({ params }) => {
  const result = await employeeService.validateInvitationToken(prisma, params.token);
  return Response.json(result);
});
