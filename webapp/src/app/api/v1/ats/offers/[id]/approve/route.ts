import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as atsService from "@/server/modules/ats/service";

// Offer approval is HR Admin/Super Admin only — a Manager (even the
// requisition's own hiring manager) has no sign-off role here. Enforced in
// the service; this role gate just matches at the route for
// defense-in-depth.
export const POST = withRoute({ roles: ["HR_ADMIN", "SUPER_ADMIN"] }, async ({ user, params }) => {
  const result = await atsService.approveOffer(prisma, params.id, user!.userId, user!.role);
  return Response.json(result);
});
