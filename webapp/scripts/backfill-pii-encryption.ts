// One-off data backfill for HRMS-11 (PAN/Aadhaar/bank account number/IFSC
// code encryption at rest). Not a Prisma migration — this is
// application-level crypto, not SQL, so it has to run as a script with the
// same PII_ENCRYPTION_KEY the app uses.
//
// Idempotent: skips any value already tagged with the `v1:` prefix
// (isEncryptedPiiValue), so it's safe to re-run after an interruption or to
// catch stragglers post-deploy.
//
// Usage (dry run by default, matching this app's pilot-data-reset
// preview/apply convention):
//   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfill-pii-encryption.ts
//   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfill-pii-encryption.ts --apply
//
// Before running --apply against production, confirm the actual row counts
// first, e.g.:
//   SELECT count(*) FROM "Employee" WHERE pan IS NOT NULL OR aadhaar IS NOT NULL
//     OR "bankAccountNumber" IS NOT NULL OR "ifscCode" IS NOT NULL;

import { PrismaClient } from "@prisma/client";
import { encryptPii, isEncryptedPiiValue } from "../src/server/lib/pii-crypto";

const ENCRYPTED_EMPLOYEE_FIELDS = ["pan", "aadhaar", "bankAccountNumber", "ifscCode"] as const;

async function migrateEmployees(prisma: PrismaClient, apply: boolean) {
  const employees = await prisma.employee.findMany({
    select: { id: true, pan: true, aadhaar: true, bankAccountNumber: true, ifscCode: true },
  });

  let migrated = 0;
  for (const emp of employees) {
    const data: Record<string, string> = {};
    for (const field of ENCRYPTED_EMPLOYEE_FIELDS) {
      const value = emp[field];
      if (typeof value === "string" && value.length > 0 && !isEncryptedPiiValue(value)) {
        data[field] = encryptPii(value);
      }
    }
    if (Object.keys(data).length === 0) continue;
    migrated++;
    if (apply) {
      await prisma.employee.update({ where: { id: emp.id }, data });
    }
  }
  return { migrated, total: employees.length };
}

async function migrateProfileChangeRequests(prisma: PrismaClient, apply: boolean) {
  const requests = await prisma.profileChangeRequest.findMany({
    where: { fieldName: { in: [...ENCRYPTED_EMPLOYEE_FIELDS] } },
  });

  let migrated = 0;
  for (const req of requests) {
    const data: Record<string, string> = {};
    if (typeof req.oldValue === "string" && req.oldValue.length > 0 && !isEncryptedPiiValue(req.oldValue)) {
      data.oldValue = encryptPii(req.oldValue);
    }
    if (typeof req.newValue === "string" && req.newValue.length > 0 && !isEncryptedPiiValue(req.newValue)) {
      data.newValue = encryptPii(req.newValue);
    }
    if (Object.keys(data).length === 0) continue;
    migrated++;
    if (apply) {
      await prisma.profileChangeRequest.update({ where: { id: req.id }, data });
    }
  }
  return { migrated, total: requests.length };
}

async function migrateEmployeeHistory(prisma: PrismaClient, apply: boolean) {
  const rows = await prisma.employeeHistory.findMany({
    where: { fieldChanged: { in: [...ENCRYPTED_EMPLOYEE_FIELDS] } },
  });

  let migrated = 0;
  for (const row of rows) {
    const data: Record<string, string> = {};
    if (typeof row.oldValue === "string" && row.oldValue.length > 0 && !isEncryptedPiiValue(row.oldValue)) {
      data.oldValue = encryptPii(row.oldValue);
    }
    if (typeof row.newValue === "string" && row.newValue.length > 0 && !isEncryptedPiiValue(row.newValue)) {
      data.newValue = encryptPii(row.newValue);
    }
    if (Object.keys(data).length === 0) continue;
    migrated++;
    if (apply) {
      await prisma.employeeHistory.update({ where: { id: row.id }, data });
    }
  }
  return { migrated, total: rows.length };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();

  try {
    const employeeResult = await migrateEmployees(prisma, apply);
    const changeRequestResult = await migrateProfileChangeRequests(prisma, apply);
    const historyResult = await migrateEmployeeHistory(prisma, apply);

    console.log(`${apply ? "APPLIED" : "DRY RUN"}:`);
    console.log(`  Employee: ${employeeResult.migrated}/${employeeResult.total} rows migrated`);
    console.log(`  ProfileChangeRequest: ${changeRequestResult.migrated}/${changeRequestResult.total} rows migrated`);
    console.log(`  EmployeeHistory: ${historyResult.migrated}/${historyResult.total} rows migrated`);
    if (!apply) {
      console.log("\nRe-run with --apply to write these changes.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
