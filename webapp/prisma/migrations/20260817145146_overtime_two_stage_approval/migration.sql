-- AlterEnum
BEGIN;
CREATE TYPE "OvertimeClaimStatus_new" AS ENUM ('PENDING_MANAGER', 'PENDING_SUPER_ADMIN', 'APPROVED', 'REJECTED');
ALTER TABLE "public"."OvertimeClaim" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "OvertimeClaim" ALTER COLUMN "status" TYPE "OvertimeClaimStatus_new" USING ("status"::text::"OvertimeClaimStatus_new");
ALTER TYPE "OvertimeClaimStatus" RENAME TO "OvertimeClaimStatus_old";
ALTER TYPE "OvertimeClaimStatus_new" RENAME TO "OvertimeClaimStatus";
DROP TYPE "public"."OvertimeClaimStatus_old";
ALTER TABLE "OvertimeClaim" ALTER COLUMN "status" SET DEFAULT 'PENDING_MANAGER';
COMMIT;

-- AlterTable
ALTER TABLE "OvertimeClaim" ADD COLUMN     "managerApproverId" TEXT,
ADD COLUMN     "managerDecidedAt" TIMESTAMP(3),
ALTER COLUMN "status" SET DEFAULT 'PENDING_MANAGER';
