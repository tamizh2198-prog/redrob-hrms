-- New Learning module: CTC-tiered course reimbursement with a manager ->
-- Super Admin approval chain, reimbursed only after a completion
-- certificate is submitted.
CREATE TYPE "LearningRequestStatus" AS ENUM ('PENDING_MANAGER', 'PENDING_SUPER_ADMIN', 'APPROVED', 'REJECTED', 'COMPLETED', 'REIMBURSED');

CREATE TABLE "LearningRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "organizationalImpact" TEXT NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "timeCommitment" TEXT NOT NULL,
    "requestYear" INTEGER NOT NULL,
    "status" "LearningRequestStatus" NOT NULL DEFAULT 'PENDING_MANAGER',
    "approverId" TEXT,
    "managerApproverId" TEXT,
    "managerDecidedAt" TIMESTAMP(3),
    "finalApproverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "certificateRef" TEXT,
    "completedAt" TIMESTAMP(3),
    "reimbursedBy" TEXT,
    "reimbursedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LearningRequest_employeeId_idx" ON "LearningRequest"("employeeId");

ALTER TABLE "LearningRequest" ADD CONSTRAINT "LearningRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
