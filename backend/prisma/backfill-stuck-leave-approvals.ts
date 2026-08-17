/**
 * One-off backfill: some LeaveApplication rows are stuck PENDING with zero
 * LeaveApprovalStep rows, so decideLeave() throws "No pending approval step
 * found" for any actor/role — undecidable by anyone.
 *
 * Root cause (fixed going forward in leave.service.ts's applyLeave(), see
 * the comment there): applyLeave() used to build approverIds from just
 * `employee.reportingManagerId` with no fallback. Any employee with no
 * reporting manager at the time (e.g. Super Admin, or anyone whose manager
 * was never assigned) got `approverIds: [null]`, which got filtered down to
 * an empty array, persisting a PENDING application with no approval step.
 *
 * This script finds exactly those applications and creates the approval
 * step(s) they should have gotten, using the same approver-selection logic
 * applyLeave() uses today (reportingManagerId, else an HR Admin/Super Admin
 * excluding the applicant; a second escalation step if daysCount > 5).
 *
 * Run with DRY_RUN (default) first, then RUN=1 to apply.
 *   DATABASE_URL=... npx ts-node prisma/backfill-stuck-leave-approvals.ts          # DRY RUN
 *   DATABASE_URL=... RUN=1 npx ts-node prisma/backfill-stuck-leave-approvals.ts    # APPLY
 */
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();
const CONSECUTIVE_DAY_ESCALATION_THRESHOLD = 5;

async function findHrAdminId(excludeId?: string): Promise<string | null> {
  const hrAdmin = await prisma.employee.findFirst({
    where: {
      role: { in: [Role.HR_ADMIN, Role.SUPER_ADMIN] },
      ...(excludeId && { id: { not: excludeId } }),
    },
  });
  return hrAdmin?.id ?? null;
}

async function main() {
  const apply = process.env.RUN === '1';

  const stuck = await prisma.leaveApplication.findMany({
    where: { status: 'PENDING', approvalSteps: { none: {} } },
    include: {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          reportingManagerId: true,
        },
      },
    },
  });

  console.log(`Stuck PENDING applications with zero approval steps: ${stuck.length}`);

  const resolvable: Array<{
    applicationId: string;
    employeeLabel: string;
    approverIds: string[];
  }> = [];
  const unresolvable: string[] = [];

  for (const app of stuck) {
    const employeeLabel = `${app.employee.employeeCode} (${app.employee.firstName} ${app.employee.lastName})`;

    let firstApproverId = app.employee.reportingManagerId;
    if (!firstApproverId) {
      firstApproverId = await findHrAdminId(app.employee.id);
    }
    if (!firstApproverId) {
      unresolvable.push(
        `  ${employeeLabel} — application ${app.id}: no reporting manager AND no other HR Admin/Super Admin exists`,
      );
      continue;
    }

    const approverIds: (string | null)[] = [firstApproverId];
    if (app.daysCount > CONSECUTIVE_DAY_ESCALATION_THRESHOLD) {
      const manager = app.employee.reportingManagerId
        ? await prisma.employee.findUnique({
            where: { id: app.employee.reportingManagerId },
          })
        : null;
      approverIds.push(manager?.reportingManagerId ?? (await findHrAdminId()));
    }

    resolvable.push({
      applicationId: app.id,
      employeeLabel,
      approverIds: approverIds.filter((id): id is string => !!id),
    });
  }

  console.log(`\nResolvable (will get approval step(s)): ${resolvable.length}`);
  for (const r of resolvable) {
    console.log(`  ${r.employeeLabel} — application ${r.applicationId}: approver chain [${r.approverIds.join(' -> ')}]`);
  }

  if (unresolvable.length > 0) {
    console.log(`\nUNRESOLVABLE — skipped, need manual attention (assign a reporting manager, then re-run): ${unresolvable.length}`);
    for (const line of unresolvable) console.log(line);
  }

  if (!apply) {
    console.log('\nDRY RUN only — no changes written. Re-run with RUN=1 to apply.');
    return;
  }

  console.log('\nApplying...');
  for (const r of resolvable) {
    await prisma.$transaction([
      prisma.leaveApprovalStep.createMany({
        data: r.approverIds.map((approverId, index) => ({
          applicationId: r.applicationId,
          approverId,
          sequence: index + 1,
        })),
      }),
      prisma.leaveApplication.update({
        where: { id: r.applicationId },
        data: { currentApproverId: r.approverIds[0] },
      }),
    ]);
  }
  console.log(`Done. Fixed ${resolvable.length} application(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
