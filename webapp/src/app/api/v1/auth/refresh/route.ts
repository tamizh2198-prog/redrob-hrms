import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { RefreshTokenDto } from "@/server/modules/auth/dto";
import { refreshSession } from "@/server/modules/auth/service";

// Section 11: "short-lived access tokens; refresh-token rotation on use."
// Rotation happens inside refreshSession, which also rejects a
// TERMINATED/ARCHIVED employee's still-valid refresh token.
export const POST = withRoute({ public: true, dto: RefreshTokenDto }, async ({ body }) => {
  const result = await refreshSession(prisma, body.refreshToken);
  return Response.json(result);
});
