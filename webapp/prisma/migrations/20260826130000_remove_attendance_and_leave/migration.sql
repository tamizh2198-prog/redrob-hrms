-- Attendance, Regularization, Overtime, and Leave (including Comp-Off) have
-- been removed as in-app features entirely. This drops their tables/enums.
-- ApprovalDecision is NOT touched here — it is shared with Workflow's
-- ApprovalRequest/WorkflowApprovalDecision, which are unrelated and stay.

-- Drop tables in dependency order (children before parents).
DROP TABLE IF EXISTS "LeaveApprovalStep";
DROP TABLE IF EXISTS "LeaveApplication";
DROP TABLE IF EXISTS "CompOffRequest";
DROP TABLE IF EXISTS "LeaveBalance";
DROP TABLE IF EXISTS "LeaveType";
DROP TABLE IF EXISTS "RegularizationRequest";
DROP TABLE IF EXISTS "AttendanceRecord";
DROP TABLE IF EXISTS "OvertimeClaim";

-- Drop now-orphaned enums.
DROP TYPE IF EXISTS "AttendanceStatus";
DROP TYPE IF EXISTS "AttendanceSource";
DROP TYPE IF EXISTS "RegularizationStatus";
DROP TYPE IF EXISTS "OvertimeClaimStatus";
DROP TYPE IF EXISTS "LeaveAccrualFrequency";
DROP TYPE IF EXISTS "LeaveApplicationStatus";
DROP TYPE IF EXISTS "CompOffRequestStatus";

-- WFO/WFH change requests become two-stage: manager, then Super Admin or HR
-- Admin. The old single 'PENDING' value becomes 'PENDING_MANAGER' (renaming
-- preserves existing rows and the column default automatically); a new
-- 'PENDING_FINAL_APPROVAL' value is added for the second stage.
ALTER TYPE "WfoWfhRequestStatus" RENAME VALUE 'PENDING' TO 'PENDING_MANAGER';
ALTER TYPE "WfoWfhRequestStatus" ADD VALUE 'PENDING_FINAL_APPROVAL';

ALTER TABLE "WfoWfhChangeRequest" ADD COLUMN "managerApproverId" TEXT;
ALTER TABLE "WfoWfhChangeRequest" ADD COLUMN "managerDecidedAt" TIMESTAMP(3);
ALTER TABLE "WfoWfhChangeRequest" ADD COLUMN "finalApproverId" TEXT;
