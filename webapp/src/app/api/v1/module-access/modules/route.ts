import { withRoute } from "@/server/lib/route";
import * as moduleAccessService from "@/server/modules/module-access/service";

export const GET = withRoute({ roles: ["SUPER_ADMIN"] }, async () => {
  return Response.json(moduleAccessService.listModules());
});
