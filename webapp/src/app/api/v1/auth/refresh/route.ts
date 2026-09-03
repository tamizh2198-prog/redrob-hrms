import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { refreshSession } from "@/server/modules/auth/service";
import { setSessionCookies } from "@/server/lib/session-cookies";
import { UnauthorizedError } from "@/server/lib/errors";

// Section 11: "short-lived access tokens; refresh-token rotation on use."
// Rotation happens inside refreshSession, which also rejects a
// TERMINATED/ARCHIVED employee's still-valid refresh token. The refresh
// token itself now travels as an httpOnly cookie, scoped to /api/v1/auth,
// rather than a body field a page script could read.
export const POST = withRoute({ public: true }, async ({ req }) => {
  const refreshToken = req.cookies.get("refresh_token")?.value;
  if (!refreshToken) throw new UnauthorizedError();
  const result = await refreshSession(prisma, refreshToken);
  await setSessionCookies(result);
  return Response.json({ status: "OK" as const });
});
