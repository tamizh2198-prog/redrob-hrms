import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { LoginDto } from "@/server/modules/auth/dto";
import * as authService from "@/server/modules/auth/service";

export const POST = withRoute({ public: true, dto: LoginDto }, async ({ body }) => {
  const result = await authService.login(prisma, body);
  return Response.json(result);
});
