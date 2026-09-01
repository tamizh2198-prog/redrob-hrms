import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { ForgotPasswordDto } from "@/server/modules/auth/dto";
import * as employeeService from "@/server/modules/employee/service";

// Always returns the same generic response regardless of whether the email
// matched an employee — never used to enumerate which emails exist.
export const POST = withRoute({ public: true, dto: ForgotPasswordDto }, async ({ body }) => {
  await employeeService.forgotPassword(prisma, body.email);
  return Response.json({
    message: "If this account exists, our HR team has been notified and will reach out.",
  });
});
