-- AlterTable
ALTER TABLE "Company" DROP COLUMN "hybridOfficeWeekdays";

-- CreateTable
CREATE TABLE "EmployeeHybridSchedule" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "officeWeekdays" INTEGER[],

    CONSTRAINT "EmployeeHybridSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeHybridSchedule_employeeId_year_month_key" ON "EmployeeHybridSchedule"("employeeId", "year", "month");

-- AddForeignKey
ALTER TABLE "EmployeeHybridSchedule" ADD CONSTRAINT "EmployeeHybridSchedule_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

