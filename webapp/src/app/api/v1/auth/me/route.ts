import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { toUserView } from "@/server/lib/auth";
import { UnauthorizedError } from "@/server/lib/errors";

// The browser app's only way to learn "am I logged in" now that the session
// tokens are httpOnly cookies it can't read — AuthContext calls this once on
// mount instead of reading a cached user out of localStorage.
export const GET = withRoute({}, async ({ user }) => {
  const employee = await prisma.employee.findUnique({ where: { id: user!.userId } });
  if (!employee) throw new UnauthorizedError();
  return Response.json(toUserView(employee));
});
