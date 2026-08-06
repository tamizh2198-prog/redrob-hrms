-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('OFFICE', 'WORK_FROM_HOME');

-- AlterEnum
ALTER TYPE "LeaveAccrualFrequency" ADD VALUE 'QUARTERLY';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "hybridOfficeWeekdays" INTEGER[] DEFAULT ARRAY[2, 4]::INTEGER[];

-- AlterTable
ALTER TABLE "LeaveType" ADD COLUMN     "code" TEXT;

-- AlterTable
ALTER TABLE "RosterEntry" ADD COLUMN     "workMode" "WorkMode" NOT NULL DEFAULT 'OFFICE';
