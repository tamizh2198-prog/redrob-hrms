import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { BootstrapSuperAdminDto } from "@/server/modules/auth/dto";
import * as employeeService from "@/server/modules/employee/service";

// First-run setup only — guarded solely by "zero employees exist yet" and
// self-closing the instant it succeeds once. Deliberately does not log the
// new account in directly — logging in afterward through /auth/login is
// what correctly routes a SUPER_ADMIN through MFA enrollment.
export const POST = withRoute({ public: true, dto: BootstrapSuperAdminDto }, async ({ body }) => {
  const employee = await employeeService.bootstrapFirstSuperAdmin(prisma, body);
  return Response.json({ employee });
});
