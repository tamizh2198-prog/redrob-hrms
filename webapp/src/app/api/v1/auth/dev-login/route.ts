import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { DevLoginDto } from "@/server/modules/auth/dto";
import * as authService from "@/server/modules/auth/service";

// Dev-only stand-in for the OIDC/SSO login flow — see service.ts's
// devLogin() for the production-environment guard.
export const POST = withRoute({ public: true, dto: DevLoginDto }, async ({ body }) => {
  const result = await authService.devLogin(prisma, body.employeeCode);
  return Response.json(result);
});
