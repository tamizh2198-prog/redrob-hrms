import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SignoffClearanceDto } from "@/server/modules/offboarding/dto";
import * as offboardingService from "@/server/modules/offboarding/service";

// Not HR-only — the checklist's EMPLOYEE_DECLARATION items are signed off
// by the exiting employee themselves; LEAD_VERIFICATION items by their
// manager. RBAC per item category is enforced in the service.
export const POST = withRoute({ dto: SignoffClearanceDto }, async ({ user, params, body }) => {
  const result = await offboardingService.signoffClearance(prisma, params.itemId, body, user!.userId, user!.role);
  return Response.json(result);
});
