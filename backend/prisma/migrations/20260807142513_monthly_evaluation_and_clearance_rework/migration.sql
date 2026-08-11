-- CreateEnum
CREATE TYPE "PerformanceGrade" AS ENUM ('FEE', 'EE', 'ME', 'PME', 'DNME');

-- CreateEnum
CREATE TYPE "EvaluationAuditStatus" AS ENUM ('PENDING_AUDIT', 'APPROVED', 'SENT_BACK');

-- CreateEnum
CREATE TYPE "ClearanceItemCategory" AS ENUM ('LEAD_VERIFICATION', 'EMPLOYEE_DECLARATION');

-- DropIndex
DROP INDEX IF EXISTS "ClearanceItem_resignationId_department_key";

-- AlterTable: added as nullable first so this doesn't fail against any
-- pre-existing rows (a plain "ADD COLUMN ... NOT NULL" would reject them
-- outright, since Postgres has no value to backfill them with) — legacy
-- rows are backfilled from their old department value below, then the
-- columns are tightened to NOT NULL once every row has one.
ALTER TABLE "ClearanceItem" ADD COLUMN     "category" "ClearanceItemCategory",
ADD COLUMN     "key" TEXT,
ADD COLUMN     "label" TEXT;

-- Backfill: legacy department-based rows have no equivalent single item in
-- the new checklist, so they're retagged under their old department name
-- as a LEAD_VERIFICATION item — preserving their existing signoff status
-- rather than silently dropping historical data.
UPDATE "ClearanceItem"
SET "key" = 'LEGACY_' || "department"::TEXT,
    "label" = 'Legacy: ' || "department"::TEXT || ' clearance',
    "category" = 'LEAD_VERIFICATION'
WHERE "key" IS NULL;

ALTER TABLE "ClearanceItem" ALTER COLUMN "category" SET NOT NULL,
ALTER COLUMN "key" SET NOT NULL,
ALTER COLUMN "label" SET NOT NULL;

ALTER TABLE "ClearanceItem" DROP COLUMN "department";

-- AlterTable
ALTER TABLE "Resignation" ADD COLUMN     "certificateReleasedBy" TEXT,
ADD COLUMN     "closingRemarks" TEXT;

-- DropEnum
DROP TYPE "ClearanceDepartment";

-- CreateTable
CREATE TABLE "MonthlyEvaluation" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "kpiScore" INTEGER NOT NULL,
    "grade" "PerformanceGrade" NOT NULL,
    "justification" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditStatus" "EvaluationAuditStatus" NOT NULL DEFAULT 'PENDING_AUDIT',
    "auditedBy" TEXT,
    "auditedAt" TIMESTAMP(3),
    "auditNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyEvaluation_employeeId_idx" ON "MonthlyEvaluation"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyEvaluation_employeeId_period_key" ON "MonthlyEvaluation"("employeeId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "ClearanceItem_resignationId_key_key" ON "ClearanceItem"("resignationId", "key");

-- AddForeignKey
ALTER TABLE "MonthlyEvaluation" ADD CONSTRAINT "MonthlyEvaluation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

