import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { AddCommentDto } from "@/server/lib/request-comments";
import * as wfoWfhService from "@/server/modules/shift/wfo-wfh-request-service";

export const POST = withRoute({ roles: ["SUPER_ADMIN"], module: "SHIFT", dto: AddCommentDto }, async ({ user, params, body }) => {
  const result = await wfoWfhService.addComment(prisma, params.id, user!.userId, body.body);
  return Response.json(result);
});

export const GET = withRoute({}, async ({ user, params }) => {
  const result = await wfoWfhService.listComments(prisma, params.id, user!.userId, user!.role);
  return Response.json(result);
});
