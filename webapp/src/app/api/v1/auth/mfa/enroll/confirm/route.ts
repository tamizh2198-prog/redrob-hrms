import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { MfaCodeDto } from "@/server/modules/auth/dto";
import * as authService from "@/server/modules/auth/service";

export const POST = withRoute({ public: true, dto: MfaCodeDto }, async ({ body }) => {
  const result = await authService.confirmMfaEnrollment(prisma, body);
  return Response.json(result);
});
