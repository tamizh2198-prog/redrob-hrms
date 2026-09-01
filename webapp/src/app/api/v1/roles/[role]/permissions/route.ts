import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { UpdateRolePermissionsDto } from "@/server/modules/permissions/dto";
import * as permissionsService from "@/server/modules/permissions/service";

export const GET = withRoute({ roles: ["SUPER_ADMIN"] }, async ({ params }) => {
  const result = await permissionsService.getRolePermissions(prisma, params.role);
  return Response.json(result);
});

export const PATCH = withRoute({ roles: ["SUPER_ADMIN"], dto: UpdateRolePermissionsDto }, async ({ params, body }) => {
  const result = await permissionsService.updateRolePermissions(prisma, params.role, body);
  return Response.json(result);
});
