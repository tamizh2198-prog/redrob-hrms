import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { RefreshTokenDto } from "@/server/modules/auth/dto";
import { rotateRefreshToken, signAccessToken } from "@/server/lib/auth";
import { UnauthorizedError } from "@/server/lib/errors";

// Section 11: "short-lived access tokens; refresh-token rotation on use."
// Rotation happens inside rotateRefreshToken — the token presented here is
// revoked and a new one issued in the same call.
export const POST = withRoute({ public: true, dto: RefreshTokenDto }, async ({ body }) => {
  const { employeeId, token } = await rotateRefreshToken(prisma, body.refreshToken);
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new UnauthorizedError("Account no longer exists");

  const accessToken = signAccessToken({ sub: employee.id, role: employee.role });
  return Response.json({ accessToken, refreshToken: token });
});
