-- CreateEnum
CREATE TYPE "WfoWfhRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OvertimeClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CompOffRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RequestCommentType" AS ENUM ('WFO_WFH_CHANGE', 'COMP_OFF', 'OVERTIME');

-- AlterTable
ALTER TABLE "LeaveType" ADD COLUMN     "isCompOff" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WfoWfhChangeRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "originalDate" TIMESTAMP(3) NOT NULL,
    "requestedWorkMode" "WorkMode" NOT NULL,
    "compensatoryDate" TIMESTAMP(3) NOT NULL,
    "compensatoryWorkMode" "WorkMode" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "WfoWfhRequestStatus" NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WfoWfhChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OvertimeClaim" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hoursClaimed" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "OvertimeClaimStatus" NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OvertimeClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompOffRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workedDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CompOffRequestStatus" NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompOffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperAdminRequestComment" (
    "id" TEXT NOT NULL,
    "requestType" "RequestCommentType" NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperAdminRequestComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WfoWfhChangeRequest_employeeId_idx" ON "WfoWfhChangeRequest"("employeeId");

-- CreateIndex
CREATE INDEX "WfoWfhChangeRequest_approverId_idx" ON "WfoWfhChangeRequest"("approverId");

-- CreateIndex
CREATE INDEX "OvertimeClaim_employeeId_idx" ON "OvertimeClaim"("employeeId");

-- CreateIndex
CREATE INDEX "OvertimeClaim_approverId_idx" ON "OvertimeClaim"("approverId");

-- CreateIndex
CREATE INDEX "CompOffRequest_employeeId_idx" ON "CompOffRequest"("employeeId");

-- CreateIndex
CREATE INDEX "CompOffRequest_approverId_idx" ON "CompOffRequest"("approverId");

-- CreateIndex
CREATE INDEX "SuperAdminRequestComment_requestType_requestId_idx" ON "SuperAdminRequestComment"("requestType", "requestId");

-- AddForeignKey
ALTER TABLE "WfoWfhChangeRequest" ADD CONSTRAINT "WfoWfhChangeRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeClaim" ADD CONSTRAINT "OvertimeClaim_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompOffRequest" ADD CONSTRAINT "CompOffRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperAdminRequestComment" ADD CONSTRAINT "SuperAdminRequestComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
