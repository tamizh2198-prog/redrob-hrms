import type { PrismaClient, Role } from "@prisma/client";
import { ForbiddenError } from "./errors";

// Full downward reporting tree (direct + indirect reports), not just direct
// reports — shared by Analytics/Assistant manager-scoped queries so neither
// has to re-derive it.
export async function getReportingHierarchyIds(prisma: PrismaClient, managerId: string): Promise<string[]> {
  const all: string[] = [];
  let frontier = [managerId];
  while (frontier.length > 0) {
    const directs = await prisma.employee.findMany({
      where: { reportingManagerId: { in: frontier } },
      select: { id: true },
    });
    const ids = directs.map((d) => d.id);
    all.push(...ids);
    frontier = ids;
  }
  return all;
}

export interface EmployeeDataRequester {
  userId?: string;
  role?: Role;
}

// HRMS-21 fix: this used to check only HR_ADMIN/SUPER_ADMIN here, while
// employee/service.ts's own isPrivilegedRole granted the same set plus
// HR_ASSOCIATE — the same role saw unmasked PII through one path and a
// ForbiddenError through another. HR_ASSOCIATE's schema comment says the
// role "mirrors HR_ADMIN's module access everywhere except it has zero
// approve/reject/decide/audit/sign-off authority," and every call site of
// assertCanAccessEmployeeData below is a read (roster, goals, review,
// resignation, onboarding progress) rather than a decision — so that
// comment resolves the divergence in favor of including HR_ASSOCIATE here
// too. Exported so this is the one place "privileged" is defined; other
// modules (e.g. employee/service.ts) import this instead of re-deriving it.
export function isPrivilegedRole(role?: Role): boolean {
  return role === "HR_ADMIN" || role === "SUPER_ADMIN" || role === "HR_ASSOCIATE";
}

// Section 6 Access Control Rule: "a Manager can only fetch records where
// employee.reporting_manager_id = self, recursively for indirect reports."
// Shared by every module whose endpoints take a target employeeId — throws
// unless the caller is that employee, that employee's manager (direct or
// indirect), or a privileged role (HR_ADMIN/HR_ASSOCIATE/SUPER_ADMIN).
export async function assertCanAccessEmployeeData(
  prisma: PrismaClient,
  targetEmployeeId: string,
  requester: EmployeeDataRequester,
): Promise<void> {
  if (isPrivilegedRole(requester.role)) return;
  if (requester.userId === targetEmployeeId) return;
  if (requester.role === "MANAGER" && requester.userId) {
    const reports = await getReportingHierarchyIds(prisma, requester.userId);
    if (reports.includes(targetEmployeeId)) return;
  }
  throw new ForbiddenError("Not authorized to access this employee's data");
}
