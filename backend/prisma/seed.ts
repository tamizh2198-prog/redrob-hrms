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

  // Section 7.7: a default-template library, not just a single fallback.
  // Exactly one company-wide (departmentId: null) template carries
  // isDefault: true — the one initChecklist() always finds on offer
  // acceptance for a department with no template of its own configured
  // (without this, the new hire's checklist/preboarding link silently
  // fails to be created — see AtsService.respondOffer's swallowed
  // NotFoundException). Every other template here is a real alternative
  // an HR Admin picks explicitly when starting onboarding manually — never
  // auto-selected. No compound unique key exists on this model, so each is
  // a manual findFirst-then-create instead of an upsert.
  const NEW_HIRE_DOCUMENTS_TASK = {
    ownerRole: 'NEW_HIRE' as const,
    phase: 'DAY_ONE' as const,
    description:
      'Submit ID proof, education certificates, bank details, and background-check consent',
    dueOffsetDays: 3,
  };

  async function seedTemplate(data: {
    name: string;
    departmentId?: string;
    isDefault?: boolean;
    tasks: Array<{
      ownerRole: 'HR' | 'IT' | 'MANAGER' | 'NEW_HIRE';
      phase: 'PRE_BOARDING' | 'DAY_ONE' | 'WEEK_ONE' | 'FIRST_90_DAYS';
      description: string;
      dueOffsetDays: number;
    }>;
  }) {
    const existing = await prisma.onboardingChecklistTemplate.findFirst({
      where: {
        companyId: company.id,
        name: data.name,
        departmentId: data.departmentId ?? null,
      },
    });
    if (existing) return;
    await prisma.onboardingChecklistTemplate.create({
      data: {
        companyId: company.id,
        name: data.name,
        departmentId: data.departmentId,
        isDefault: data.isDefault ?? false,
        taskTemplates: { create: data.tasks },
      },
    });
  }

  await seedTemplate({
    name: 'Default Onboarding Checklist',
    isDefault: true,
    tasks: [
      {
        ownerRole: 'HR',
        phase: 'PRE_BOARDING',
        description: 'Prepare offer letter and employment contract',
        dueOffsetDays: 0,
      },
      {
        ownerRole: 'IT',
        phase: 'PRE_BOARDING',
        description: 'Provision laptop, email, and system access',
        dueOffsetDays: 0,
      },
      {
        ownerRole: 'MANAGER',
        phase: 'DAY_ONE',
        description: 'Plan first-week onboarding schedule',
        dueOffsetDays: 1,
      },
      NEW_HIRE_DOCUMENTS_TASK,
      {
        ownerRole: 'HR',
        phase: 'WEEK_ONE',
        description: 'Conduct orientation and policy walkthrough',
        dueOffsetDays: 5,
      },
      {
        ownerRole: 'MANAGER',
        phase: 'FIRST_90_DAYS',
        description: 'Complete 90-day performance check-in',
        dueOffsetDays: 85,
      },
    ],
  });

  // Department-scoped — auto-selected for anyone hired into Engineering
  // (see `department` below), ahead of the company-wide default.
  await seedTemplate({
    name: 'Engineering Onboarding',
    departmentId: department.id,
    tasks: [
      {
        ownerRole: 'HR',
        phase: 'PRE_BOARDING',
        description: 'Prepare offer letter and employment contract',
        dueOffsetDays: 0,
      },
      {
        ownerRole: 'IT',
        phase: 'PRE_BOARDING',
        description: 'Provision laptop, dev accounts, and VPN access',
        dueOffsetDays: 0,
      },
      {
        ownerRole: 'IT',
        phase: 'DAY_ONE',
        description: 'Grant repository and CI/CD access',
        dueOffsetDays: 0,
      },
      {
        ownerRole: 'MANAGER',
        phase: 'DAY_ONE',
        description: 'Assign an onboarding buddy and a pair-programming session',
        dueOffsetDays: 1,
      },
      NEW_HIRE_DOCUMENTS_TASK,
      {
        ownerRole: 'HR',
        phase: 'WEEK_ONE',
        description: 'Conduct orientation and policy walkthrough',
        dueOffsetDays: 5,
      },
      {
        ownerRole: 'MANAGER',
        phase: 'WEEK_ONE',
        description: 'Walk through codebase architecture and coding standards',
        dueOffsetDays: 5,
      },
      {
        ownerRole: 'MANAGER',
        phase: 'FIRST_90_DAYS',
        description: 'Review first project contribution and give feedback',
        dueOffsetDays: 30,
      },
      {
        ownerRole: 'MANAGER',
        phase: 'FIRST_90_DAYS',
        description: 'Complete 90-day performance check-in',
        dueOffsetDays: 85,
      },
    ],
  });

  // Company-wide, library-only — an HR Admin picks this explicitly for a
  // Sales hire (no Sales department is seeded, so it's never auto-selected).
  await seedTemplate({
    name: 'Sales Onboarding',
    tasks: [
      {
        ownerRole: 'HR',
        phase: 'PRE_BOARDING',
        description: 'Prepare offer letter and employment contract',
        dueOffsetDays: 0,
      },
      {
        ownerRole: 'IT',
        phase: 'PRE_BOARDING',
        description: 'Provision laptop, email, and CRM access',
        dueOffsetDays: 0,
      },
      {
        ownerRole: 'MANAGER',
        phase: 'DAY_ONE',
        description: 'Introduce to the sales team and assign a mentor',
        dueOffsetDays: 1,
      },
      NEW_HIRE_DOCUMENTS_TASK,
      {
        ownerRole: 'HR',
        phase: 'WEEK_ONE',
        description: 'Conduct orientation and policy walkthrough',
        dueOffsetDays: 5,
      },
      {
        ownerRole: 'MANAGER',
        phase: 'WEEK_ONE',
        description: 'Walk through territory, quota, and pipeline expectations',
        dueOffsetDays: 5,
      },
      {
        ownerRole: 'MANAGER',
        phase: 'WEEK_ONE',
        description: 'Shadow a live sales call',
        dueOffsetDays: 7,
      },
      {
        ownerRole: 'MANAGER',
        phase: 'FIRST_90_DAYS',
        description: 'Complete 90-day performance check-in',
        dueOffsetDays: 85,
      },
    ],
  });

  // Company-wide, library-only — for a fully remote hire, in-office-specific
  // tasks (desk setup, in-person orientation) are swapped for their remote
  // equivalents.
  await seedTemplate({
    name: 'Remote Employee Onboarding',
    tasks: [
      {
        ownerRole: 'HR',
        phase: 'PRE_BOARDING',
        description: 'Prepare offer letter and employment contract',
        dueOffsetDays: 0,
      },
      {
        ownerRole: 'IT',
        phase: 'PRE_BOARDING',
        description: 'Ship laptop and equipment to home address',
        dueOffsetDays: 0,
      },
      {
        ownerRole: 'HR',
        phase: 'PRE_BOARDING',
        description: 'Confirm home-office setup and stipend details',
        dueOffsetDays: 0,
      },
      {
        ownerRole: 'MANAGER',
        phase: 'DAY_ONE',
        description: 'Host a virtual welcome call with the team',
        dueOffsetDays: 0,
      },
      NEW_HIRE_DOCUMENTS_TASK,
      {
        ownerRole: 'HR',
        phase: 'WEEK_ONE',
        description: 'Conduct orientation and policy walkthrough (virtual)',
        dueOffsetDays: 5,
      },
      {
        ownerRole: 'MANAGER',
        phase: 'WEEK_ONE',
        description: 'Set up recurring 1:1s and communication norms',
        dueOffsetDays: 5,
      },
      {
        ownerRole: 'MANAGER',
        phase: 'FIRST_90_DAYS',
        description: 'Complete 90-day performance check-in',
        dueOffsetDays: 85,
      },
    ],
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
  // Keyed on workEmail, not employeeCode: employeeCode gets reassigned by
  // the MNR-<year>-<seq> backfill/generator over an environment's lifetime,
  // so matching on it here would stop finding these rows on re-seed and
  // fall into create(), colliding on the already-taken workEmail instead.
  const superAdmin = await prisma.employee.upsert({
    where: { workEmail: 'aditi.rao@redrob.seed' },
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
    where: { workEmail: 'priya.sharma@redrob.seed' },
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
    where: { workEmail: 'karan.mehta@redrob.seed' },
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
    where: { workEmail: 'rahul.verma@redrob.seed' },
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

  // Section 7.5: a reasonable India 2026 national holiday list for the
  // seeded location — fixed-date statutory holidays only (no lunar-
  // calendar festivals guessed here). This is the ONLY holiday data
  // source: Dashboard's "Upcoming Holidays" and Attendance's calendar
  // both read the same Holiday rows via HolidayService/CalendarService.
  const INDIA_HOLIDAYS_2026 = [
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-10-02', name: 'Gandhi Jayanti' },
    { date: '2026-12-25', name: 'Christmas' },
  ];
  for (const h of INDIA_HOLIDAYS_2026) {
    await prisma.holiday.upsert({
      where: { locationId_date: { locationId: location.id, date: new Date(h.date) } },
      update: { name: h.name },
      create: {
        locationId: location.id,
        year: 2026,
        date: new Date(h.date),
        name: h.name,
        isOptional: false,
      },
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
