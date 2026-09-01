import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as employeeService from "@/server/modules/employee/service";

export const GET = withRoute({ roles: ["HR_ADMIN", "SUPER_ADMIN"] }, async ({ req }) => {
  const status = req.nextUrl.searchParams.get("status") as "PENDING" | "APPROVED" | "REJECTED" | null;
  const result = await employeeService.listChangeRequests(prisma, status ?? undefined);
  return Response.json(result);
});
