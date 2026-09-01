import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as employeeService from "@/server/modules/employee/service";

export const GET = withRoute({}, async () => {
  const result = await employeeService.getReferenceData(prisma);
  return Response.json(result);
});
