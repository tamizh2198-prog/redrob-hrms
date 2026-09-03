import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { revokeRefreshToken } from "@/server/lib/auth";
import { clearSessionCookies } from "@/server/lib/session-cookies";

export const POST = withRoute({ public: true }, async ({ req }) => {
  const refreshToken = req.cookies.get("refresh_token")?.value;
  if (refreshToken) {
    await revokeRefreshToken(prisma, refreshToken);
  }
  await clearSessionCookies();
  return Response.json({ success: true });
});
