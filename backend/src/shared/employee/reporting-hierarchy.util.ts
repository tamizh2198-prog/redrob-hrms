import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

// Full downward reporting tree (direct + indirect reports), not just direct
// reports — shared by Analytics (Section 7.13) and Assistant (Section 7.14)
// manager-scoped queries so neither has to re-derive it.
export async function getReportingHierarchyIds(
  prisma: PrismaService,
  managerId: string,
): Promise<string[]> {
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

// Section 6 Access Control Rule: "a Manager can only fetch records where
// employee.reporting_manager_id = self, recursively for indirect reports."
// Shared by every module whose endpoints take a target employeeId — throws
// unless the caller is that employee, that employee's manager (direct or
// indirect), or HR_ADMIN/SUPER_ADMIN.
export async function assertCanAccessEmployeeData(
  prisma: PrismaService,
  targetEmployeeId: string,
  requester: EmployeeDataRequester,
): Promise<void> {
  if (requester.role === Role.HR_ADMIN || requester.role === Role.SUPER_ADMIN) {
    return;
  }
  if (requester.userId === targetEmployeeId) return;
  if (requester.role === Role.MANAGER && requester.userId) {
    const reports = await getReportingHierarchyIds(prisma, requester.userId);
    if (reports.includes(targetEmployeeId)) return;
  }
  throw new ForbiddenException("Not authorized to access this employee's data");
}
