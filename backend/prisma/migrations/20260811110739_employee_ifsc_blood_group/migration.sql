-- CreateEnum
CREATE TYPE "BloodGroup" AS ENUM ('A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "bloodGroup" "BloodGroup",
ADD COLUMN     "ifscCode" TEXT;
