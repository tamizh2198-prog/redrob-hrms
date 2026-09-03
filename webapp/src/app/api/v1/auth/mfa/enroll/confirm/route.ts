import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { MfaCodeDto } from "@/server/modules/auth/dto";
import * as authService from "@/server/modules/auth/service";
import { setDeviceCookie, setSessionCookies } from "@/server/lib/session-cookies";

export const POST = withRoute({ public: true, dto: MfaCodeDto }, async ({ body }) => {
  const result = await authService.confirmMfaEnrollment(prisma, body);
  await setSessionCookies(result);
  await setDeviceCookie(result.deviceToken);
  return Response.json({ status: "OK" as const, user: result.user });
});
