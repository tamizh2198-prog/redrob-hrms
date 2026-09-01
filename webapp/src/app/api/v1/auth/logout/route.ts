import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { RefreshTokenDto } from "@/server/modules/auth/dto";
import { revokeRefreshToken } from "@/server/lib/auth";

export const POST = withRoute({ public: true, dto: RefreshTokenDto }, async ({ body }) => {
  await revokeRefreshToken(prisma, body.refreshToken);
  return Response.json({ success: true });
});
