import {
  PrismaClient,
  Role,
  Gender,
  EmploymentType,
  EmployeeStatus,
} from '@prisma/client';
import { hashPassword } from '../src/shared/auth/password.util';
import {
  PERMISSION_CATALOG,
  DEFAULT_ROLE_PERMISSIONS,
} from '../src/modules/permissions/permission-catalog';

const prisma = new PrismaClient();

// Phase 1: dev-only default so `npm run prisma:seed` keeps working out of
// the box — override with a real value via SUPER_ADMIN_SEED_PASSWORD for
// any shared/non-local environment. Never hardcoded silently in prod.
const SUPER_ADMIN_SEED_PASSWORD =
  process.env.SUPER_ADMIN_SEED_PASSWORD ?? 'ChangeMe123!';
if (!process.env.SUPER_ADMIN_SEED_PASSWORD) {
  console.warn(
    'SUPER_ADMIN_SEED_PASSWORD not set — seeding Super Admin with the dev-only default password. Set this env var for any non-local environment.',
  );
}

// Same reasoning as above, for the other three demo seed users (HR Admin,
// Manager, Employee) — a single shared password is fine for these since
// they're lower-privilege than Super Admin, and this is purely a local
// demo convenience so every role can be logged into directly instead of
// only being reachable via dev-login or a real invitation.
const DEMO_SEED_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? 'Demo@123456';
if (!process.env.DEMO_SEED_PASSWORD) {
  console.warn(
    'DEMO_SEED_PASSWORD not set — seeding HR Admin/Manager/Employee with the dev-only default password. Set this env var for any non-local environment.',
  );
}

async function main() {
  const company = await prisma.company.upsert({
    where: { id: 'seed-company' },
    update: {},
    create: { id: 'seed-company', name: 'Redrob' },
  });

  // Section 7.3 leave types: EL accrues monthly, SL/CL accrue quarterly.
  await prisma.leaveType.upsert({
    where: { companyId_name: { companyId: company.id, name: 'Earned Leave' } },
    update: {},
    create: {
      companyId: company.id,
      name: 'Earned Leave',
      code: 'EL',
      accrualFrequency: 'MONTHLY',
      accrualRate: 1,
      maxCarryForward: 10,
      isEncashable: true,
    },
  });

  await prisma.leaveType.upsert({
    where: { companyId_name: { companyId: company.id, name: 'Sick Leave' } },
    update: {},
    create: {
      companyId: company.id,
      name: 'Sick Leave',
      code: 'SL',
      accrualFrequency: 'QUARTERLY',
      accrualRate: 1,
      requiresDocumentAfterDays: 3,
    },
  });

  await prisma.leaveType.upsert({
    where: { companyId_name: { companyId: company.id, name: 'Care Leave' } },
    update: {},
    create: {
      companyId: company.id,
      name: 'Care Leave',
      code: 'CL',
      accrualFrequency: 'QUARTERLY',
      accrualRate: 1,
    },
  });

  // Section 7.4: a default shift template so Assign Roster has something to
  // pick from immediately, instead of an empty dropdown until HR creates one.
  await prisma.shift.upsert({
    where: { companyId_name: { companyId: company.id, name: 'General Shift' } },
    update: { startTime: '10:00', endTime: '19:00' },
    create: {
      companyId: company.id,
      name: 'General Shift',
      startTime: '10:00',
      endTime: '19:00',
    },
  });

  const department = await prisma.department.upsert({
    where: { companyId_code: { companyId: company.id, code: 'ENG' } },
    update: {},
    create: { companyId: company.id, name: 'Engineering', code: 'ENG' },
  });

  const designationManager = await prisma.designation.upsert({
    where: { companyId_code: { companyId: company.id, code: 'ENG-MGR' } },
    update: {},
    create: { companyId: company.id, name: 'Engineering Manager', code: 'ENG-MGR' },
  });

  const designationEngineer = await prisma.designation.upsert({
    where: { companyId_code: { companyId: company.id, code: 'SWE' } },
    update: {},
    create: { companyId: company.id, name: 'Software Engineer', code: 'SWE' },
  });

  const designationHr = await prisma.designation.upsert({
    where: { companyId_code: { companyId: company.id, code: 'HR-ADM' } },
    update: {},
    create: { companyId: company.id, name: 'HR Administrator', code: 'HR-ADM' },
  });

  const designationAdmin = await prisma.designation.upsert({
    where: { companyId_code: { companyId: company.id, code: 'SUPER-ADM' } },
    update: {},
    create: { companyId: company.id, name: 'Super Administrator', code: 'SUPER-ADM' },
  });

  const location = await prisma.location.upsert({
    where: { companyId_code: { companyId: company.id, code: 'BLR' } },
    update: {},
    create: { companyId: company.id, name: 'Bengaluru', code: 'BLR' },
  });

  const grade = await prisma.grade.upsert({
    where: { companyId_code: { companyId: company.id, code: 'L3' } },
    update: {},
    create: { companyId: company.id, name: 'L3', code: 'L3' },
  });

  const baseFields = {
    companyId: company.id,
    departmentId: department.id,
    locationId: location.id,
    gradeId: grade.id,
    dob: new Date('1990-01-01'),
    gender: Gender.PREFER_NOT_TO_SAY,
    dateOfJoining: new Date('2024-01-01'),
    employmentType: EmploymentType.FULL_TIME,
    status: EmployeeStatus.ACTIVE,
    pan: 'ABCDE1234F',
    bankAccountNumber: '000123456789',
    emergencyContactName: 'Emergency Contact',
    emergencyContactPhone: '9999999999',
  };

  const superAdminPasswordHash = await hashPassword(SUPER_ADMIN_SEED_PASSWORD);
  const superAdmin = await prisma.employee.upsert({
    where: { employeeCode: 'EMP-SEED-0001' },
    // Section 11: MFA state is reset on every seed run too, not just the
    // password — otherwise re-seeding leaves this account demanding a
    // TOTP code from whatever authenticator last enrolled it, which a
    // fresh environment has no way to produce.
    update: {
      passwordHash: superAdminPasswordHash,
      mfaEnabled: false,
      mfaSecret: null,
    },
    create: {
      ...baseFields,
      employeeCode: 'EMP-SEED-0001',
      firstName: 'Aditi',
      lastName: 'Rao',
      workEmail: 'aditi.rao@redrob.seed',
      role: Role.SUPER_ADMIN,
      designationId: designationAdmin.id,
      passwordHash: superAdminPasswordHash,
    },
  });

  const demoPasswordHash = await hashPassword(DEMO_SEED_PASSWORD);

  const hrAdmin = await prisma.employee.upsert({
    where: { employeeCode: 'EMP-SEED-0002' },
    update: {
      passwordHash: demoPasswordHash,
      mfaEnabled: false,
      mfaSecret: null,
    },
    create: {
      ...baseFields,
      employeeCode: 'EMP-SEED-0002',
      firstName: 'Priya',
      lastName: 'Sharma',
      workEmail: 'priya.sharma@redrob.seed',
      role: Role.HR_ADMIN,
      designationId: designationHr.id,
      reportingManagerId: superAdmin.id,
      passwordHash: demoPasswordHash,
    },
  });

  const manager = await prisma.employee.upsert({
    where: { employeeCode: 'EMP-SEED-0003' },
    update: { passwordHash: demoPasswordHash },
    create: {
      ...baseFields,
      employeeCode: 'EMP-SEED-0003',
      firstName: 'Karan',
      lastName: 'Mehta',
      workEmail: 'karan.mehta@redrob.seed',
      role: Role.MANAGER,
      designationId: designationManager.id,
      reportingManagerId: superAdmin.id,
      passwordHash: demoPasswordHash,
    },
  });

  await prisma.employee.upsert({
    where: { employeeCode: 'EMP-SEED-0004' },
    update: { passwordHash: demoPasswordHash },
    create: {
      ...baseFields,
      employeeCode: 'EMP-SEED-0004',
      firstName: 'Rahul',
      lastName: 'Verma',
      workEmail: 'rahul.verma@redrob.seed',
      role: Role.EMPLOYEE,
      designationId: designationEngineer.id,
      reportingManagerId: manager.id,
      passwordHash: demoPasswordHash,
    },
  });

  // Auth Phase 5: seed the permission catalog and default role mappings.
  // Additive/idempotent — upserts by unique key, never resets existing
  // rows, so re-running the seed after a role's permissions have been
  // customized via the admin UI won't clobber that customization... except
  // it deliberately DOES reset to defaults on every seed run for a role
  // that has no existing RolePermission rows yet (first run only).
  const permissionByKey = new Map<string, { id: string }>();
  for (const def of PERMISSION_CATALOG) {
    const permission = await prisma.permission.upsert({
      where: { key: def.key },
      update: { name: def.name, description: def.description, category: def.category },
      create: def,
    });
    permissionByKey.set(def.key, permission);
  }

  for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS) as [
    Role,
    string[],
  ][]) {
    const existingCount = await prisma.rolePermission.count({ where: { role } });
    if (existingCount > 0) continue;
    await prisma.rolePermission.createMany({
      data: keys
        .map((key) => permissionByKey.get(key))
        .filter((p): p is { id: string } => !!p)
        .map((p) => ({ role, permissionId: p.id })),
    });
  }

  console.log('Seed complete.');
  console.log('');
  console.log('Demo login credentials (sign in with work email + password):');
  console.log(
    `  Super Admin — aditi.rao@redrob.seed / ${SUPER_ADMIN_SEED_PASSWORD}`,
  );
  console.log(
    `  HR Admin    — priya.sharma@redrob.seed / ${DEMO_SEED_PASSWORD}`,
  );
  console.log(
    `  Manager     — karan.mehta@redrob.seed / ${DEMO_SEED_PASSWORD}`,
  );
  console.log(
    `  Employee    — rahul.verma@redrob.seed / ${DEMO_SEED_PASSWORD}`,
  );
  console.log(
    'Super Admin and HR Admin will be prompted to set up MFA on first login.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
