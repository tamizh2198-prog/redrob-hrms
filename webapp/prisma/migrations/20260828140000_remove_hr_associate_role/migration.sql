-- HR Associate is being removed as a role entirely — the remaining roles
-- are EMPLOYEE, MANAGER, HR_ADMIN, SUPER_ADMIN. Any existing HR_ASSOCIATE
-- employee is reassigned to plain EMPLOYEE (confirmed by the user).
--
-- Postgres has no native DROP VALUE for enums, so this rebuilds the type —
-- same pattern already used in this repo at
-- 20260817145146_overtime_two_stage_approval/migration.sql.
BEGIN;

UPDATE "Employee" SET role = 'EMPLOYEE' WHERE role = 'HR_ASSOCIATE';
DELETE FROM "RolePermission" WHERE role = 'HR_ASSOCIATE';

CREATE TYPE "Role_new" AS ENUM ('EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN');
ALTER TABLE "Employee" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "Employee" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TABLE "RolePermission" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
ALTER TABLE "Employee" ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE';

COMMIT;
