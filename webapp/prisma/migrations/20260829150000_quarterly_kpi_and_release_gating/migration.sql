-- New standalone quarterly KPI percentage (manager-submitted, Super-Admin-
-- approved, released the day after approval), plus a one-time marker on
-- both MonthlyEvaluation and the new QuarterlyKpi so the release-
-- notification cron never double-sends.
ALTER TABLE "MonthlyEvaluation" ADD COLUMN "releaseNotifiedAt" TIMESTAMP(3);

CREATE TABLE "QuarterlyKpi" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "kpiPercent" DOUBLE PRECISION NOT NULL,
    "justification" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditStatus" "EvaluationAuditStatus" NOT NULL DEFAULT 'PENDING_AUDIT',
    "auditedBy" TEXT,
    "auditedAt" TIMESTAMP(3),
    "auditNotes" TEXT,
    "releaseNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuarterlyKpi_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuarterlyKpi_employeeId_idx" ON "QuarterlyKpi"("employeeId");

CREATE UNIQUE INDEX "QuarterlyKpi_employeeId_year_quarter_key" ON "QuarterlyKpi"("employeeId", "year", "quarter");

ALTER TABLE "QuarterlyKpi" ADD CONSTRAINT "QuarterlyKpi_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
