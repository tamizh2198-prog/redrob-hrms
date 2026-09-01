import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateWfoWfhRequestDto } from "@/server/modules/shift/dto";
import * as wfoWfhService from "@/server/modules/shift/wfo-wfh-request-service";

export const POST = withRoute({ dto: CreateWfoWfhRequestDto }, async ({ user, body }) => {
  const result = await wfoWfhService.submit(prisma, user!.userId, body, user!.role);
  return Response.json(result);
});

export const GET = withRoute({ roles: ["SUPER_ADMIN"], module: "SHIFT" }, async ({ req }) => {
  const status = req.nextUrl.searchParams.get("status") as
    | "PENDING_MANAGER"
    | "PENDING_FINAL_APPROVAL"
    | "APPROVED"
    | "REJECTED"
    | null;
  const result = await wfoWfhService.listAll(prisma, status ?? undefined);
  return Response.json(result);
});
