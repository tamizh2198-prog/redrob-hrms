import { withRoute } from "@/server/lib/route";
import * as permissionsService from "@/server/modules/permissions/service";

export const GET = withRoute({ roles: ["SUPER_ADMIN"] }, async () => {
  const result = permissionsService.listRoles();
  return Response.json(result);
});
