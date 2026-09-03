import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { LoginDto } from "@/server/modules/auth/dto";
import * as authService from "@/server/modules/auth/service";
import { setSessionCookies } from "@/server/lib/session-cookies";

export const POST = withRoute({ public: true, dto: LoginDto }, async ({ req, body }) => {
  // "Remember this device" now travels as an httpOnly cookie, not a body
  // field the client can be trusted to forward — this always wins over
  // whatever (if anything) a stale client still sends in the body.
  const deviceToken = req.cookies.get("device_token")?.value;
  const result = await authService.login(prisma, { ...body, deviceToken });
  if (result.status !== "OK") {
    return Response.json(result);
  }
  await setSessionCookies(result);
  return Response.json({ status: "OK" as const, user: result.user });
});
