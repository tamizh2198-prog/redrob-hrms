-- Phased checklists: every task now belongs to a phase (Pre-boarding /
-- Day 1 / Week 1 / First 90 days). Existing rows have no way to know their
-- real intended phase retroactively, so they're backfilled to DAY_ONE
-- before the column is made required.
CREATE TYPE "OnboardingPhase" AS ENUM ('PRE_BOARDING', 'DAY_ONE', 'WEEK_ONE', 'FIRST_90_DAYS');

ALTER TABLE "ChecklistTaskTemplate" ADD COLUMN "phase" "OnboardingPhase";
UPDATE "ChecklistTaskTemplate" SET "phase" = 'DAY_ONE' WHERE "phase" IS NULL;
ALTER TABLE "ChecklistTaskTemplate" ALTER COLUMN "phase" SET NOT NULL;

ALTER TABLE "ChecklistTask" ADD COLUMN "phase" "OnboardingPhase";
UPDATE "ChecklistTask" SET "phase" = 'DAY_ONE' WHERE "phase" IS NULL;
ALTER TABLE "ChecklistTask" ALTER COLUMN "phase" SET NOT NULL;

-- Multi-template library: exactly one company-wide template should be the
-- automatic fallback (isDefault) so findApplicableTemplate() stays
-- deterministic once more than one company-wide template exists.
ALTER TABLE "OnboardingChecklistTemplate" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- 30/60/90-day probation feedback: one row per (employee, checkpoint),
-- pre-created at probation start, reminderSentAt guarding each checkpoint
-- so a scheduled sweep fires it exactly once.
CREATE TYPE "ProbationCheckpoint" AS ENUM ('DAY_30', 'DAY_60', 'DAY_90');

CREATE TABLE "ProbationFeedback" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "checkpoint" "ProbationCheckpoint" NOT NULL,
    "reminderSentAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "companyRating" INTEGER,
    "workCultureRating" INTEGER,
    "comments" TEXT,

    CONSTRAINT "ProbationFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProbationFeedback_employeeId_checkpoint_key" ON "ProbationFeedback"("employeeId", "checkpoint");

ALTER TABLE "ProbationFeedback" ADD CONSTRAINT "ProbationFeedback_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
