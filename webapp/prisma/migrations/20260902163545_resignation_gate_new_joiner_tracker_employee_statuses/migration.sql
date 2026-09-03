-- CreateEnum
CREATE TYPE "NewJoinerTrackerItem" AS ENUM ('JOINING_KIT', 'ID_CARD', 'CONFIRMATION_HAMPER');

-- CreateEnum
CREATE TYPE "NewJoinerTrackerStatus" AS ENUM ('PENDING', 'ASSIGNED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ResignationLetterStatus" AS ENUM ('NOT_READY', 'PENDING_VERIFICATION', 'SENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmployeeStatus" ADD VALUE 'PIP';
ALTER TYPE "EmployeeStatus" ADD VALUE 'CURE_PERIOD';

-- AlterEnum
ALTER TYPE "ResignationStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Resignation" ADD COLUMN     "letterDataSnapshot" JSONB,
ADD COLUMN     "letterStatus" "ResignationLetterStatus" NOT NULL DEFAULT 'NOT_READY',
ADD COLUMN     "lwdNotificationSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NewJoinerTracker" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "item" "NewJoinerTrackerItem" NOT NULL,
    "status" "NewJoinerTrackerStatus" NOT NULL DEFAULT 'PENDING',
    "assignedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,

    CONSTRAINT "NewJoinerTracker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewJoinerTracker_employeeId_item_key" ON "NewJoinerTracker"("employeeId", "item");

-- AddForeignKey
ALTER TABLE "NewJoinerTracker" ADD CONSTRAINT "NewJoinerTracker_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
