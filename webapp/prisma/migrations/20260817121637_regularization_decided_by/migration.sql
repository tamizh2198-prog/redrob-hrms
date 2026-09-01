-- AlterTable
ALTER TABLE "RegularizationRequest" ADD COLUMN     "decidedById" TEXT;

-- CreateIndex
CREATE INDEX "RegularizationRequest_decidedById_idx" ON "RegularizationRequest"("decidedById");

-- AddForeignKey
ALTER TABLE "RegularizationRequest" ADD CONSTRAINT "RegularizationRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
