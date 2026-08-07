-- CreateEnum
CREATE TYPE "PerformanceGrade" AS ENUM ('FEE', 'EE', 'ME', 'PME', 'DNME');

-- CreateEnum
CREATE TYPE "EvaluationAuditStatus" AS ENUM ('PENDING_AUDIT', 'APPROVED', 'SENT_BACK');

-- CreateEnum
CREATE TYPE "ClearanceItemCategory" AS ENUM ('LEAD_VERIFICATION', 'EMPLOYEE_DECLARATION');

-- DropIndex
DROP INDEX "ClearanceItem_resignationId_department_key";

-- AlterTable
ALTER TABLE "ClearanceItem" DROP COLUMN "department",
ADD COLUMN     "category" "ClearanceItemCategory" NOT NULL,
ADD COLUMN     "key" TEXT NOT NULL,
ADD COLUMN     "label" TEXT NOT NULL;

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

