// Removes exactly what seed-demo-data.ts created, using the manifest that
// script writes as the sole source of truth — never a heuristic/prefix
// guess. Safe to run against a database that also has real data, since it
// only ever touches the specific ids recorded in the manifest.
//
// Run: `npm run seed:demo:wipe`

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const MANIFEST_PATH = path.join(__dirname, 'demo-data-manifest.json');

interface Manifest {
  createdAt: string;
  companyId: string;
  employeeIds: string[];
  departmentIds: string[];
  designationIds: string[];
  gradeIds: string[];
  locationIds: string[];
  holidayIds: string[];
  reviewCycleIds: string[];
  jobRequisitionIds: string[];
  candidateIds: string[];
  assetIds: string[];
  ticketIds: string[];
  announcementIds: string[];
  resignationIds: string[];
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.log(`No manifest found at ${MANIFEST_PATH} — nothing to wipe (or seed-demo-data.ts was never run).`);
    return;
  }
  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  const { employeeIds } = manifest;

  console.log(`Wiping demo data seeded at ${manifest.createdAt}...`);

  // --- Helpdesk ---
  await prisma.ticketMessage.deleteMany({
    where: { OR: [{ ticketId: { in: manifest.ticketIds } }, { senderId: { in: employeeIds } }] },
  });
  await prisma.ticket.deleteMany({
    where: {
      OR: [
        { id: { in: manifest.ticketIds } },
        { employeeId: { in: employeeIds } },
        { assignedAgentId: { in: employeeIds } },
      ],
    },
  });

  // --- Announcements ---
  await prisma.announcementAck.deleteMany({
    where: { OR: [{ announcementId: { in: manifest.announcementIds } }, { employeeId: { in: employeeIds } }] },
  });
  await prisma.announcement.deleteMany({
    where: { OR: [{ id: { in: manifest.announcementIds } }, { createdBy: { in: employeeIds } }] },
  });

  // --- Recognition (not created by this seed, but a demo employee could be
  // either side of one created through the live app while testing) ---
  await prisma.recognition.deleteMany({
    where: { OR: [{ senderId: { in: employeeIds } }, { recipientId: { in: employeeIds } }] },
  });

  // --- Assets ---
  await prisma.assetAssignment.deleteMany({
    where: { OR: [{ assetId: { in: manifest.assetIds } }, { employeeId: { in: employeeIds } }] },
  });
  await prisma.assetRequest.deleteMany({
    where: { OR: [{ employeeId: { in: employeeIds } }, { approverId: { in: employeeIds } }] },
  });
  await prisma.asset.deleteMany({ where: { id: { in: manifest.assetIds } } });

  // --- Recruitment ---
  await prisma.offer.deleteMany({ where: { candidateId: { in: manifest.candidateIds } } });
  await prisma.interviewRound.deleteMany({
    where: { OR: [{ candidateId: { in: manifest.candidateIds } }, { interviewerId: { in: employeeIds } }] },
  });
  await prisma.candidate.deleteMany({ where: { id: { in: manifest.candidateIds } } });
  await prisma.jobRequisition.deleteMany({
    where: { OR: [{ id: { in: manifest.jobRequisitionIds } }, { hiringManagerId: { in: employeeIds } }] },
  });

  // --- Performance ---
  await prisma.reviewCorrection.deleteMany({ where: { review: { cycleId: { in: manifest.reviewCycleIds } } } });
  await prisma.review.deleteMany({
    where: { OR: [{ cycleId: { in: manifest.reviewCycleIds } }, { employeeId: { in: employeeIds } }] },
  });
  await prisma.goal.deleteMany({
    where: { OR: [{ cycleId: { in: manifest.reviewCycleIds } }, { employeeId: { in: employeeIds } }] },
  });
  await prisma.reviewCycle.deleteMany({ where: { id: { in: manifest.reviewCycleIds } } });
  await prisma.monthlyEvaluation.deleteMany({ where: { employeeId: { in: employeeIds } } });

  // --- Leave ---
  await prisma.leaveApprovalStep.deleteMany({
    where: {
      OR: [{ application: { employeeId: { in: employeeIds } } }, { approverId: { in: employeeIds } }],
    },
  });
  await prisma.leaveApplication.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.leaveBalance.deleteMany({ where: { employeeId: { in: employeeIds } } });

  // --- Attendance / shift & roster ---
  await prisma.attendanceRecord.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.regularizationRequest.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.rosterEntry.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.employeeHybridSchedule.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.shiftSwapRequest.deleteMany({
    where: { OR: [{ requesterId: { in: employeeIds } }, { counterpartId: { in: employeeIds } }] },
  });
  await prisma.optionalHolidaySelection.deleteMany({ where: { employeeId: { in: employeeIds } } });

  // --- Onboarding / preboarding (not created by this seed, but defensive) ---
  await prisma.checklistTask.deleteMany({ where: { checklist: { employeeId: { in: employeeIds } } } });
  await prisma.onboardingChecklist.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.preboardingSubmission.deleteMany({ where: { employeeId: { in: employeeIds } } });

  // --- Resignation / offboarding ---
  await prisma.finalSettlement.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.exitInterview.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.clearanceItem.deleteMany({ where: { resignationId: { in: manifest.resignationIds } } });
  await prisma.lwdAdjustment.deleteMany({ where: { resignationId: { in: manifest.resignationIds } } });
  await prisma.resignation.deleteMany({
    where: { OR: [{ id: { in: manifest.resignationIds } }, { employeeId: { in: employeeIds } }] },
  });

  // --- Assistant, policy docs, saved reports (user-initiated; demo
  // employees can't log in to create these, but defensive) ---
  await prisma.assistantMessage.deleteMany({ where: { conversation: { employeeId: { in: employeeIds } } } });
  await prisma.assistantConversation.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.policyDocument.deleteMany({ where: { uploadedById: { in: employeeIds } } });
  await prisma.savedReport.deleteMany({ where: { createdById: { in: employeeIds } } });

  // --- Generic workflow/approval engine (same reasoning — defensive) ---
  await prisma.workflowApprovalDecision.deleteMany({
    where: {
      OR: [{ approverId: { in: employeeIds } }, { request: { requestedById: { in: employeeIds } } }],
    },
  });
  await prisma.approvalRequest.deleteMany({ where: { requestedById: { in: employeeIds } } });
  await prisma.workflowDefinition.deleteMany({ where: { createdById: { in: employeeIds } } });

  // --- Notifications — the actual trigger for adding this section: the
  // live dev server's background schedulers (e.g. profile-completion
  // reminders) create these for real against newly-seeded employees while
  // the app happens to be running, independent of anything this script
  // itself inserts. ---
  await prisma.notificationLog.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.notificationPreference.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.notification.deleteMany({ where: { employeeId: { in: employeeIds } } });

  // --- Per-module access grants (defensive) ---
  await prisma.moduleAccessGrant.deleteMany({ where: { employeeId: { in: employeeIds } } });

  // --- Employee record/profile-change history, invitations (defensive) ---
  await prisma.employeeDocument.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.employeeHistory.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.profileChangeRequest.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.employeeInvitation.deleteMany({ where: { employeeId: { in: employeeIds } } });

  // --- Session/auth rows (defensive — demo employees have no password, so
  // these should be empty, but harmless to include) ---
  await prisma.refreshToken.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.trustedDevice.deleteMany({ where: { employeeId: { in: employeeIds } } });

  // --- Employees: null out the self-referential manager links first so
  // deleting managers before their reports doesn't hit the FK constraint
  // (reportingManagerId is onDelete: NoAction). ---
  await prisma.employee.updateMany({
    where: { id: { in: employeeIds } },
    data: { reportingManagerId: null },
  });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });

  // --- Reference data this script's own seed created (not seed.ts's) ---
  await prisma.holiday.deleteMany({ where: { id: { in: manifest.holidayIds } } });
  await prisma.department.deleteMany({ where: { id: { in: manifest.departmentIds } } });
  await prisma.designation.deleteMany({ where: { id: { in: manifest.designationIds } } });
  await prisma.grade.deleteMany({ where: { id: { in: manifest.gradeIds } } });
  await prisma.location.deleteMany({ where: { id: { in: manifest.locationIds } } });

  fs.unlinkSync(MANIFEST_PATH);
  console.log('Demo data wiped clean.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
