-- CreateEnum
CREATE TYPE "ReviewCycleType" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- AlterTable
ALTER TABLE "ReviewCycle" ADD COLUMN "cycleType" "ReviewCycleType" NOT NULL DEFAULT 'QUARTERLY';
