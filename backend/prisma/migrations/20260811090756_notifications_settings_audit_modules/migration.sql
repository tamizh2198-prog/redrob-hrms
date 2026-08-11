-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SLACK', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('GOOGLE_SSO', 'SLACK', 'SMS_GATEWAY', 'EMAIL_GATEWAY', 'BIOMETRIC');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'CONFIGURED', 'ERROR');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "eventCategory" TEXT NOT NULL,
    "channelsEnabled" "NotificationChannel"[],

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'SENT',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 4,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "IntegrationType" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "statusCode" INTEGER,
    "requestBody" JSONB,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_employeeId_createdAt_idx" ON "Notification"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_employeeId_readAt_idx" ON "Notification"("employeeId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_employeeId_eventCategory_key" ON "NotificationPreference"("employeeId", "eventCategory");

-- CreateIndex
CREATE INDEX "NotificationLog_employeeId_createdAt_idx" ON "NotificationLog"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_template_idx" ON "NotificationLog"("template");

-- CreateIndex
CREATE UNIQUE INDEX "CompanySettings_companyId_key" ON "CompanySettings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConfig_companyId_type_key" ON "IntegrationConfig"("companyId", "type");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_module_idx" ON "AuditLog"("module");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConfig" ADD CONSTRAINT "IntegrationConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
