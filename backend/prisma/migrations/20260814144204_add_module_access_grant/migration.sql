-- CreateTable
CREATE TABLE "ModuleAccessGrant" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModuleAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModuleAccessGrant_employeeId_idx" ON "ModuleAccessGrant"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleAccessGrant_employeeId_module_key" ON "ModuleAccessGrant"("employeeId", "module");

-- AddForeignKey
ALTER TABLE "ModuleAccessGrant" ADD CONSTRAINT "ModuleAccessGrant_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
