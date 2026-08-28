// Generates a realistic ~220-employee demo dataset across Employee,
// Recruitment, Assets, Helpdesk, Announcements (plus the minimum
// Performance/Resignation rows those modules' own dashboards read) so the
// app's dashboards and AI assistant have meaningful, non-empty data to work
// with in a demo/review environment.
//
// Deliberately NOT wired into `npm run prisma:seed` / package.json's
// `prisma.seed` hook — that command runs on every deploy restart (see
// railway.json), and this dataset must never be regenerated automatically.
// Run explicitly: `npm run seed:demo`. Wipe with `npm run seed:demo:wipe`,
// which reads the manifest this script writes to remove exactly what it
// created — nothing else.
//
// All generated people/records are tagged so they're unambiguous to spot
// and safe to delete before real rollout:
//   - employeeCode: "DEMO-0001".."DEMO-0220" (never collides with the
//     "EMP-{year}-####" pattern real employee creation uses, or "EMP-SEED-"
//     used by the four hand-authored login accounts in seed.ts)
//   - workEmail: "first.last@redrob.demo" (never a real company domain)
//
// Reference data (departments/designations/grades/locations/holidays) is
// created for realism but is ordinary reusable lookup data, not "fake
// people" — the wipe script removes it too, since it exists only to support
// this demo batch, but leaves untouched anything seed.ts created.

import {
  PrismaClient,
  Role,
  Gender,
  EmploymentType,
  EmployeeStatus,
  RequisitionStatus,
  CandidateStage,
  OfferStatus,
  AssetStatus,
  AssetRequestStatus,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  AnnouncementScope,
  AnnouncementPriority,
  ReviewCycleType,
  ReviewStatus,
  ResignationStatus,
} from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const MANIFEST_PATH = path.join(__dirname, 'demo-data-manifest.json');
const EMAIL_DOMAIN = 'redrob.demo';
const EMPLOYEE_CODE_PREFIX = 'DEMO-';

// ---------------------------------------------------------------------------
// RNG / date helpers — plain Math.random()/Date.now() are fine here, this is
// a one-shot Node script, not a Workflow.
// ---------------------------------------------------------------------------

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomFloat(min: number, max: number, decimals = 1): number {
  const v = Math.random() * (max - min) + min;
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}
function pick<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}
function weightedPick<T>(entries: [T, number][]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [value, weight] of entries) {
    if (r < weight) return value;
    r -= weight;
  }
  return entries[entries.length - 1][0];
}
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Matches AnalyticsService/CalendarService's own startOfDay exactly (UTC
// midnight) — attendance rows must line up with this or the dashboard's
// exact-date-match queries silently see nothing.
function utcMidnight(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
}
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function daysBetweenInclusive(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}
const TODAY = startOfDay(new Date());

// ---------------------------------------------------------------------------
// Name pools
// ---------------------------------------------------------------------------

const FIRST_NAMES_MALE = [
  'Arjun', 'Rohan', 'Vikram', 'Aditya', 'Sanjay', 'Rahul', 'Karan', 'Nikhil',
  'Amit', 'Suresh', 'Vivek', 'Manish', 'Deepak', 'Ravi', 'Ajay', 'Sameer',
  'Anand', 'Gaurav', 'Kunal', 'Varun', 'Siddharth', 'Harsh', 'Mohit', 'Naveen',
  'Prakash', 'Rajesh', 'Sandeep', 'Tarun', 'Vishal', 'Yash',
];
const FIRST_NAMES_FEMALE = [
  'Priya', 'Ananya', 'Kavya', 'Neha', 'Pooja', 'Shreya', 'Divya', 'Sneha',
  'Riya', 'Aishwarya', 'Meera', 'Nisha', 'Swati', 'Kritika', 'Anjali', 'Ritu',
  'Sakshi', 'Tanvi', 'Isha', 'Juhi', 'Lakshmi', 'Madhuri', 'Namita', 'Pallavi',
  'Radhika', 'Sunita', 'Trisha', 'Urvashi', 'Vidya', 'Zara',
];
const LAST_NAMES = [
  'Sharma', 'Verma', 'Mehta', 'Rao', 'Gupta', 'Kumar', 'Singh', 'Patel',
  'Reddy', 'Nair', 'Iyer', 'Joshi', 'Malhotra', 'Kapoor', 'Chopra', 'Bose',
  'Desai', 'Pillai', 'Menon', 'Agarwal', 'Bhatt', 'Chatterjee', 'Das', 'Ghosh',
  'Jain', 'Khanna', 'Mishra', 'Pandey', 'Rastogi', 'Saxena', 'Trivedi', 'Yadav',
];

const usedEmails = new Set<string>();
function makeEmail(first: string, last: string): string {
  const base = `${first.toLowerCase()}.${last.toLowerCase()}`;
  let candidate = `${base}@${EMAIL_DOMAIN}`;
  let n = 1;
  while (usedEmails.has(candidate)) {
    n += 1;
    candidate = `${base}${n}@${EMAIL_DOMAIN}`;
  }
  usedEmails.add(candidate);
  return candidate;
}
function randomPerson(): { first: string; last: string; gender: Gender; email: string } {
  const isMale = Math.random() < 0.5;
  const first = isMale ? pick(FIRST_NAMES_MALE) : pick(FIRST_NAMES_FEMALE);
  const last = pick(LAST_NAMES);
  const gender = isMale ? Gender.MALE : Gender.FEMALE;
  return { first, last, gender, email: makeEmail(first, last) };
}

// ---------------------------------------------------------------------------
// Chunked createMany — keeps a single query's parameter count sane and
// avoids one giant round-trip for the ~15k-row attendance table.
// ---------------------------------------------------------------------------

async function createManyChunked<T>(
  fn: (chunk: T[]) => Promise<unknown>,
  rows: T[],
  chunkSize = 500,
) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await fn(rows.slice(i, i + chunkSize));
  }
}

// ---------------------------------------------------------------------------
// Manifest — the wipe script's only source of truth for what to delete.
// ---------------------------------------------------------------------------

interface Manifest {
  createdAt: string;
  companyId: string;
  employeeIds: string[];
  departmentIds: string[];
  designationIds: string[];
  gradeIds: string[];
  locationIds: string[];
  holidayIds: string[];
  reviewCycleIds: string[];
  jobRequisitionIds: string[];
  candidateIds: string[];
  assetIds: string[];
  ticketIds: string[];
  announcementIds: string[];
  resignationIds: string[];
}

async function main() {
  // Deliberately NOT `prisma.company.findFirst()` — this dev database has
  // accumulated many Company rows from unrelated E2E/QA runs over time, and
  // findFirst() with no ordering can return any of them. We need the exact
  // company the four seed.ts login accounts belong to, since that's the
  // companyId every dashboard query the seeded HR Admin/Super Admin will
  // actually look at is scoped to.
  const hrAdmin = await prisma.employee.findUnique({
    where: { employeeCode: 'EMP-SEED-0002' },
  });
  const superAdmin = await prisma.employee.findUnique({
    where: { employeeCode: 'EMP-SEED-0001' },
  });
  if (!hrAdmin || !superAdmin) {
    throw new Error(
      'Base seed accounts (EMP-SEED-0001/0002) not found — run `npm run prisma:seed` first.',
    );
  }
  const company = { id: superAdmin.companyId };

  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    companyId: company.id,
    employeeIds: [],
    departmentIds: [],
    designationIds: [],
    gradeIds: [],
    locationIds: [],
    holidayIds: [],
    reviewCycleIds: [],
    jobRequisitionIds: [],
    candidateIds: [],
    assetIds: [],
    ticketIds: [],
    announcementIds: [],
    resignationIds: [],
  };

  const existingEmployeeCount = await prisma.employee.count({
    where: { employeeCode: { startsWith: EMPLOYEE_CODE_PREFIX } },
  });
  if (existingEmployeeCount > 0) {
    console.log(
      `Found ${existingEmployeeCount} existing "${EMPLOYEE_CODE_PREFIX}*" employees — demo data already seeded. Run \`npm run seed:demo:wipe\` first if you want to regenerate it.`,
    );
    return;
  }

  // -------------------------------------------------------------------------
  // Reference data: locations, grades, designations, departments, holidays
  // -------------------------------------------------------------------------

  console.log('Creating reference data (locations, grades, designations, departments)...');

  const locationBlr = await prisma.location.upsert({
    where: { companyId_code: { companyId: company.id, code: 'BLR' } },
    update: {},
    create: { companyId: company.id, name: 'Bengaluru', code: 'BLR' },
  });
  const locationMum = await prisma.location.upsert({
    where: { companyId_code: { companyId: company.id, code: 'MUM' } },
    update: {},
    create: { companyId: company.id, name: 'Mumbai', code: 'MUM' },
  });
  const locationPun = await prisma.location.upsert({
    where: { companyId_code: { companyId: company.id, code: 'PUN' } },
    update: {},
    create: { companyId: company.id, name: 'Pune', code: 'PUN' },
  });
  manifest.locationIds.push(locationMum.id, locationPun.id);
  const LOCATIONS = [
    { location: locationBlr, weight: 55 },
    { location: locationMum, weight: 25 },
    { location: locationPun, weight: 20 },
  ];

  // Same fixed-date national holidays seed.ts already uses for BLR — mirrored
  // onto the two new locations so the holiday calendar works everywhere, not
  // just Bengaluru.
  const INDIA_HOLIDAYS_2026 = [
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-10-02', name: 'Gandhi Jayanti' },
    { date: '2026-12-25', name: 'Christmas' },
  ];
  for (const loc of [locationBlr, locationMum, locationPun]) {
    for (const h of INDIA_HOLIDAYS_2026) {
      const holiday = await prisma.holiday.upsert({
        where: { locationId_date: { locationId: loc.id, date: new Date(h.date) } },
        update: { name: h.name },
        create: {
          locationId: loc.id,
          year: 2026,
          date: new Date(h.date),
          name: h.name,
          isOptional: false,
        },
      });
      // Only track newly-relevant ones for the two new locations in the
      // manifest — BLR's holidays predate this script and aren't ours to wipe.
      if (loc.id !== locationBlr.id) manifest.holidayIds.push(holiday.id);
    }
  }

  const gradeL1 = await prisma.grade.upsert({
    where: { companyId_code: { companyId: company.id, code: 'L1' } },
    update: {},
    create: { companyId: company.id, name: 'L1', code: 'L1' },
  });
  const gradeL2 = await prisma.grade.upsert({
    where: { companyId_code: { companyId: company.id, code: 'L2' } },
    update: {},
    create: { companyId: company.id, name: 'L2', code: 'L2' },
  });
  const gradeL3 = await prisma.grade.upsert({
    where: { companyId_code: { companyId: company.id, code: 'L3' } },
    update: {},
    create: { companyId: company.id, name: 'L3', code: 'L3' },
  });
  const gradeL4 = await prisma.grade.upsert({
    where: { companyId_code: { companyId: company.id, code: 'L4' } },
    update: {},
    create: { companyId: company.id, name: 'L4', code: 'L4' },
  });
  const gradeL5 = await prisma.grade.upsert({
    where: { companyId_code: { companyId: company.id, code: 'L5' } },
    update: {},
    create: { companyId: company.id, name: 'L5', code: 'L5' },
  });
  manifest.gradeIds.push(gradeL1.id, gradeL2.id, gradeL4.id, gradeL5.id);
  const IC_GRADES = [gradeL1, gradeL2, gradeL3];
  const MANAGER_GRADES = [gradeL4, gradeL5];

  interface DeptConfig {
    code: string;
    name: string;
    total: number;
    managerDesig: { code: string; name: string };
    icDesigs: { code: string; name: string }[];
  }
  const DEPARTMENTS: DeptConfig[] = [
    {
      code: 'ENG',
      name: 'Engineering',
      total: 66,
      managerDesig: { code: 'ENG-MGR', name: 'Engineering Manager' },
      icDesigs: [
        { code: 'SWE', name: 'Software Engineer' },
        { code: 'SR-SWE', name: 'Senior Software Engineer' },
      ],
    },
    {
      code: 'SALES',
      name: 'Sales',
      total: 32,
      managerDesig: { code: 'SALES-MGR', name: 'Sales Manager' },
      icDesigs: [
        { code: 'SALES-EXEC', name: 'Sales Executive' },
        { code: 'SR-SALES-EXEC', name: 'Senior Sales Executive' },
      ],
    },
    {
      code: 'CS',
      name: 'Customer Support',
      total: 32,
      managerDesig: { code: 'CS-MGR', name: 'Customer Support Manager' },
      icDesigs: [
        { code: 'CS-ASSOC', name: 'Support Associate' },
        { code: 'SR-CS-ASSOC', name: 'Senior Support Associate' },
      ],
    },
    {
      code: 'MKT',
      name: 'Marketing',
      total: 22,
      managerDesig: { code: 'MKT-MGR', name: 'Marketing Manager' },
      icDesigs: [
        { code: 'MKT-ASSOC', name: 'Marketing Associate' },
        { code: 'SR-MKT-ASSOC', name: 'Senior Marketing Associate' },
      ],
    },
    {
      code: 'PROD',
      name: 'Product',
      total: 22,
      managerDesig: { code: 'PROD-MGR', name: 'Product Manager' },
      icDesigs: [
        { code: 'PROD-ANALYST', name: 'Product Analyst' },
        { code: 'SR-PROD-ANALYST', name: 'Senior Product Analyst' },
      ],
    },
    {
      code: 'FIN',
      name: 'Finance',
      total: 22,
      managerDesig: { code: 'FIN-MGR', name: 'Finance Manager' },
      icDesigs: [
        { code: 'FIN-ANALYST', name: 'Finance Analyst' },
        { code: 'SR-FIN-ANALYST', name: 'Senior Finance Analyst' },
      ],
    },
    {
      code: 'OPS',
      name: 'Operations',
      total: 24,
      managerDesig: { code: 'OPS-MGR', name: 'Operations Manager' },
      icDesigs: [
        { code: 'OPS-ASSOC', name: 'Operations Associate' },
        { code: 'SR-OPS-ASSOC', name: 'Senior Operations Associate' },
      ],
    },
  ];

  const departmentByCode = new Map<string, { id: string }>();
  const designationByCode = new Map<string, { id: string }>();
  for (const dept of DEPARTMENTS) {
    const department = await prisma.department.upsert({
      where: { companyId_code: { companyId: company.id, code: dept.code } },
      update: {},
      create: { companyId: company.id, name: dept.name, code: dept.code },
    });
    departmentByCode.set(dept.code, department);
    if (dept.code !== 'ENG') manifest.departmentIds.push(department.id);

    const managerDesig = await prisma.designation.upsert({
      where: { companyId_code: { companyId: company.id, code: dept.managerDesig.code } },
      update: {},
      create: { companyId: company.id, name: dept.managerDesig.name, code: dept.managerDesig.code },
    });
    designationByCode.set(dept.managerDesig.code, managerDesig);
    if (dept.managerDesig.code !== 'ENG-MGR') manifest.designationIds.push(managerDesig.id);

    for (const icDesig of dept.icDesigs) {
      const designation = await prisma.designation.upsert({
        where: { companyId_code: { companyId: company.id, code: icDesig.code } },
        update: {},
        create: { companyId: company.id, name: icDesig.name, code: icDesig.code },
      });
      designationByCode.set(icDesig.code, designation);
      if (icDesig.code !== 'SWE') manifest.designationIds.push(designation.id);
    }
  }

  // -------------------------------------------------------------------------
  // Employees
  // -------------------------------------------------------------------------

  console.log('Creating ~220 employees...');

  interface DemoEmployee {
    id: string;
    firstName: string;
    lastName: string;
    role: Role;
    departmentCode: string;
    locationId: string;
    dateOfJoining: Date;
    status: EmployeeStatus;
  }
  const allEmployees: DemoEmployee[] = [];
  const managersByDept = new Map<string, DemoEmployee[]>();
  let seq = 1;

  function randomJoinDate(): Date {
    // Weighted toward "been here a while" with a realistic tail of recent
    // joiners — 1-4 years back, skewed recent.
    const daysBack = Math.round(Math.pow(Math.random(), 1.5) * 4 * 365);
    return startOfDay(addDays(TODAY, -daysBack));
  }
  function statusForJoinDate(joinDate: Date): EmployeeStatus {
    if (daysBetweenInclusive(joinDate, TODAY) <= 90) return EmployeeStatus.ACTIVE_PROBATION;
    if (Math.random() < 0.015) return EmployeeStatus.ON_LEAVE;
    return EmployeeStatus.ACTIVE;
  }

  for (const dept of DEPARTMENTS) {
    const managerCount = Math.max(2, Math.ceil(dept.total * 0.1));
    const icCount = dept.total - managerCount;
    const managerDesig = designationByCode.get(dept.managerDesig.code)!;
    const department = departmentByCode.get(dept.code)!;
    const deptManagers: DemoEmployee[] = [];

    for (let i = 0; i < managerCount; i++) {
      const person = randomPerson();
      const joinDate = randomJoinDate();
      const loc = weightedPick(LOCATIONS.map((l) => [l.location, l.weight] as [typeof l.location, number]));
      const reportsTo = i % 2 === 0 ? superAdmin.id : hrAdmin.id;
      const employee = await prisma.employee.create({
        data: {
          companyId: company.id,
          employeeCode: `${EMPLOYEE_CODE_PREFIX}${String(seq).padStart(4, '0')}`,
          firstName: person.first,
          lastName: person.last,
          workEmail: person.email,
          gender: person.gender,
          dob: new Date(1975 + randomInt(0, 20), randomInt(0, 11), randomInt(1, 28)),
          departmentId: department.id,
          designationId: managerDesig.id,
          gradeId: pick(MANAGER_GRADES).id,
          locationId: loc.id,
          reportingManagerId: reportsTo,
          dateOfJoining: joinDate,
          employmentType: EmploymentType.FULL_TIME,
          status: statusForJoinDate(joinDate),
          role: Role.MANAGER,
        },
      });
      seq += 1;
      const demo: DemoEmployee = {
        id: employee.id,
        firstName: person.first,
        lastName: person.last,
        role: Role.MANAGER,
        departmentCode: dept.code,
        locationId: loc.id,
        dateOfJoining: joinDate,
        status: employee.status,
      };
      allEmployees.push(demo);
      deptManagers.push(demo);
      manifest.employeeIds.push(employee.id);
    }
    managersByDept.set(dept.code, deptManagers);

    const icDesigs = dept.icDesigs.map((d) => designationByCode.get(d.code)!);
    for (let i = 0; i < icCount; i++) {
      const person = randomPerson();
      const joinDate = randomJoinDate();
      const loc = weightedPick(LOCATIONS.map((l) => [l.location, l.weight] as [typeof l.location, number]));
      const manager = deptManagers[i % deptManagers.length];
      const employee = await prisma.employee.create({
        data: {
          companyId: company.id,
          employeeCode: `${EMPLOYEE_CODE_PREFIX}${String(seq).padStart(4, '0')}`,
          firstName: person.first,
          lastName: person.last,
          workEmail: person.email,
          gender: person.gender,
          dob: new Date(1985 + randomInt(0, 15), randomInt(0, 11), randomInt(1, 28)),
          departmentId: department.id,
          designationId: pick(icDesigs).id,
          gradeId: pick(IC_GRADES).id,
          locationId: loc.id,
          reportingManagerId: manager.id,
          dateOfJoining: joinDate,
          employmentType: weightedPick([
            [EmploymentType.FULL_TIME, 90],
            [EmploymentType.CONTRACT, 6],
            [EmploymentType.INTERN, 3],
            [EmploymentType.PART_TIME, 1],
          ]),
          status: statusForJoinDate(joinDate),
          role: Role.EMPLOYEE,
        },
      });
      seq += 1;
      allEmployees.push({
        id: employee.id,
        firstName: person.first,
        lastName: person.last,
        role: Role.EMPLOYEE,
        departmentCode: dept.code,
        locationId: loc.id,
        dateOfJoining: joinDate,
        status: employee.status,
      });
      manifest.employeeIds.push(employee.id);
    }
  }
  console.log(`  ${allEmployees.length} employees created.`);

  // A handful of terminated employees + Resignation rows, so the HR Admin
  // dashboard's 90-day attrition count isn't a flat zero.
  console.log('Creating a few resignations (attrition)...');
  const terminatedCandidates = shuffle(allEmployees.filter((e) => e.role === Role.EMPLOYEE)).slice(0, 3);
  for (const emp of terminatedCandidates) {
    const submittedDate = addDays(TODAY, -randomInt(20, 80));
    const noticePeriodDays = pick([15, 30, 60]);
    const lastWorkingDay = addDays(submittedDate, noticePeriodDays);
    await prisma.employee.update({ where: { id: emp.id }, data: { status: EmployeeStatus.TERMINATED } });
    emp.status = EmployeeStatus.TERMINATED;
    const resignation = await prisma.resignation.create({
      data: {
        employeeId: emp.id,
        submittedDate,
        noticePeriodDays,
        lastWorkingDay,
        status: ResignationStatus.SETTLED,
        rehireEligible: true,
      },
    });
    manifest.resignationIds.push(resignation.id);
  }

  const activeEmployees = allEmployees.filter((e) => e.status !== EmployeeStatus.TERMINATED);

  // -------------------------------------------------------------------------
  // Performance — minimum needed for Manager dashboard goal-progress% and
  // the assistant's `pending_reviews` tool to return real data.
  // -------------------------------------------------------------------------

  console.log('Creating a lightweight performance review cycle...');
  const reviewCycle = await prisma.reviewCycle.create({
    data: {
      companyId: company.id,
      name: 'Q3 2026 Performance Review',
      cycleType: ReviewCycleType.QUARTERLY,
      periodStart: new Date('2026-07-01'),
      periodEnd: new Date('2026-09-30'),
      status: 'OPEN',
    },
  });
  manifest.reviewCycleIds.push(reviewCycle.id);

  const goalRows = activeEmployees
    .filter((e) => e.role === Role.EMPLOYEE)
    .map((emp) => {
      const target = 100;
      const actual = randomInt(20, 100);
      return {
        employeeId: emp.id,
        cycleId: reviewCycle.id,
        title: pick([
          'Ship quarterly roadmap commitments',
          'Improve customer satisfaction score',
          'Reduce process turnaround time',
          'Complete certification/training goal',
          'Grow pipeline / revenue contribution',
        ]),
        target,
        actual,
        weightage: 100,
      };
    });
  await createManyChunked((chunk) => prisma.goal.createMany({ data: chunk }), goalRows);

  const reviewRows = activeEmployees
    .filter((e) => e.role === Role.EMPLOYEE)
    .map((emp) => ({
      cycleId: reviewCycle.id,
      employeeId: emp.id,
      status: weightedPick<ReviewStatus>([
        [ReviewStatus.NOT_STARTED, 40],
        [ReviewStatus.IN_PROGRESS, 40],
        [ReviewStatus.READY_FOR_CALIBRATION, 20],
      ]),
    }));
  await createManyChunked((chunk) => prisma.review.createMany({ data: chunk }), reviewRows);
  console.log(`  ${goalRows.length} goals, ${reviewRows.length} reviews (none finalized).`);

  // -------------------------------------------------------------------------
  // Recruitment — a handful of open pipelines
  // -------------------------------------------------------------------------

  console.log('Creating recruitment pipelines...');

  const REQS: { deptCode: string; title: string; status: RequisitionStatus; headcount: number }[] = [
    { deptCode: 'ENG', title: 'Senior Backend Engineer', status: RequisitionStatus.PUBLISHED, headcount: 2 },
    { deptCode: 'ENG', title: 'Frontend Engineer', status: RequisitionStatus.PUBLISHED, headcount: 1 },
    { deptCode: 'SALES', title: 'Enterprise Account Executive', status: RequisitionStatus.PUBLISHED, headcount: 1 },
    { deptCode: 'CS', title: 'Customer Support Specialist', status: RequisitionStatus.PUBLISHED, headcount: 2 },
    { deptCode: 'PROD', title: 'Product Manager', status: RequisitionStatus.APPROVED, headcount: 1 },
    { deptCode: 'MKT', title: 'Content Marketing Lead', status: RequisitionStatus.PENDING_APPROVAL, headcount: 1 },
  ];
  const CANDIDATE_SOURCES = ['LinkedIn', 'Referral', 'Naukri', 'Company Website'];
  const STAGE_WEIGHTS: [CandidateStage, number][] = [
    [CandidateStage.APPLIED, 30], [CandidateStage.SCREENING, 20], [CandidateStage.INTERVIEW, 20],
    [CandidateStage.OFFER, 10], [CandidateStage.HIRED, 10], [CandidateStage.REJECTED, 10],
  ];

  for (const req of REQS) {
    const dept = departmentByCode.get(req.deptCode)!;
    const manager = pick(managersByDept.get(req.deptCode)!);
    const requisition = await prisma.jobRequisition.create({
      data: {
        companyId: company.id,
        title: req.title,
        departmentId: dept.id,
        hiringManagerId: manager.id,
        headcount: req.headcount,
        status: req.status,
        approvedBy: req.status === RequisitionStatus.PENDING_APPROVAL ? null : hrAdmin.id,
        approvedAt: req.status === RequisitionStatus.PENDING_APPROVAL ? null : addDays(TODAY, -randomInt(10, 40)),
        budgetCtc: randomInt(8, 30) * 100000,
      },
    });
    manifest.jobRequisitionIds.push(requisition.id);

    const candidateCount = randomInt(4, 8);
    const interviewerPool = shuffle(managersByDept.get(req.deptCode)!);
    for (let i = 0; i < candidateCount; i++) {
      const person = randomPerson();
      const stage = weightedPick(STAGE_WEIGHTS);
      const appliedAt = addDays(TODAY, -randomInt(3, 55));
      const candidate = await prisma.candidate.create({
        data: {
          requisitionId: requisition.id,
          name: `${person.first} ${person.last}`,
          email: `${person.first.toLowerCase()}.${person.last.toLowerCase()}.candidate${i}@example.com`,
          phone: `9${randomInt(100000000, 999999999)}`,
          source: pick(CANDIDATE_SOURCES),
          currentStage: stage,
          appliedAt,
        },
      });
      manifest.candidateIds.push(candidate.id);

      const interviewStages: CandidateStage[] = [CandidateStage.INTERVIEW, CandidateStage.OFFER, CandidateStage.HIRED];
      if (interviewStages.includes(stage)) {
        await prisma.interviewRound.create({
          data: {
            candidateId: candidate.id,
            interviewerId: pick(interviewerPool).id,
            scheduledAt: addDays(appliedAt, randomInt(3, 10)),
            completedAt: addDays(appliedAt, randomInt(3, 10)),
            recommendation: pick(['STRONG_YES', 'YES', 'MAYBE']),
            scorecardJson: { communication: randomInt(3, 5), technical: randomInt(3, 5) },
          },
        });
      }
      const offerStages: CandidateStage[] = [CandidateStage.OFFER, CandidateStage.HIRED];
      if (offerStages.includes(stage)) {
        const offerStatus = stage === CandidateStage.HIRED ? OfferStatus.ACCEPTED : OfferStatus.SENT;
        await prisma.offer.create({
          data: {
            candidateId: candidate.id,
            ctcBreakupJson: { ctcLpa: randomInt(8, 35) },
            status: offerStatus,
            hiringManagerApprovedBy: manager.id,
            hiringManagerApprovedAt: addDays(appliedAt, 15),
            hrApprovedBy: hrAdmin.id,
            hrApprovedAt: addDays(appliedAt, 16),
            sentAt: addDays(appliedAt, 17),
            acceptedAt: stage === CandidateStage.HIRED ? addDays(appliedAt, 20) : null,
          },
        });
      }
    }
  }
  console.log(`  ${REQS.length} requisitions created.`);

  // -------------------------------------------------------------------------
  // Assets
  // -------------------------------------------------------------------------

  console.log('Creating asset inventory...');

  const ASSET_CATALOG: { category: string; weight: number; makes: [string, string][] }[] = [
    { category: 'Laptop', weight: 45, makes: [['Dell', 'Latitude 5440'], ['Lenovo', 'ThinkPad T14'], ['Apple', 'MacBook Air M2'], ['HP', 'EliteBook 840']] },
    { category: 'Monitor', weight: 25, makes: [['Dell', 'P2422H'], ['LG', '24MP400'], ['Samsung', 'S24R350']] },
    { category: 'Mobile Phone', weight: 15, makes: [['Apple', 'iPhone 13'], ['Samsung', 'Galaxy A54'], ['OnePlus', 'Nord CE3']] },
    { category: 'Headset', weight: 10, makes: [['Jabra', 'Evolve2 40'], ['Logitech', 'H390']] },
    { category: 'Keyboard & Mouse Kit', weight: 5, makes: [['Logitech', 'MK270'], ['Dell', 'KM3322W']] },
  ];
  const ASSET_COUNT = 200;
  const assetRows: {
    id?: string; category: string; make: string; model: string; serialNumber: string;
    purchaseDate: Date; cost: number; warrantyExpiry: Date; status: AssetStatus;
  }[] = [];
  for (let i = 0; i < ASSET_COUNT; i++) {
    const entry = weightedPick(ASSET_CATALOG.map((c) => [c, c.weight] as [typeof c, number]));
    const [make, model] = pick(entry.makes);
    const purchaseDate = addDays(TODAY, -randomInt(30, 1100));
    const status = weightedPick<AssetStatus>([
      [AssetStatus.ISSUED, 78], [AssetStatus.AVAILABLE, 15], [AssetStatus.IN_REPAIR, 4], [AssetStatus.RETIRED, 3],
    ]);
    assetRows.push({
      category: entry.category,
      make,
      model,
      serialNumber: `SN-${entry.category.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(5, '0')}`,
      purchaseDate,
      cost: entry.category === 'Laptop' ? randomInt(40000, 120000) : randomInt(3000, 40000),
      warrantyExpiry: addDays(purchaseDate, 365 * pick([1, 2, 3])),
      status,
    });
  }

  const createdAssets: { id: string; status: AssetStatus; category: string }[] = [];
  for (const row of assetRows) {
    const asset = await prisma.asset.create({
      data: {
        companyId: company.id,
        category: row.category,
        make: row.make,
        model: row.model,
        serialNumber: row.serialNumber,
        purchaseDate: row.purchaseDate,
        cost: row.cost,
        warrantyExpiry: row.warrantyExpiry,
        condition: row.status === AssetStatus.IN_REPAIR ? 'NEEDS_REPAIR' : 'GOOD',
        status: row.status,
      },
    });
    manifest.assetIds.push(asset.id);
    createdAssets.push({ id: asset.id, status: asset.status, category: row.category });
  }

  const issuedAssets = createdAssets.filter((a) => a.status === AssetStatus.ISSUED);
  const assignmentEmployeePool = shuffle(activeEmployees);
  const assignmentRows = issuedAssets.map((asset, i) => ({
    assetId: asset.id,
    employeeId: assignmentEmployeePool[i % assignmentEmployeePool.length].id,
    issuedAt: addDays(TODAY, -randomInt(5, 900)),
    acknowledgedAt: addDays(TODAY, -randomInt(1, 899)),
  }));
  await createManyChunked((chunk) => prisma.assetAssignment.createMany({ data: chunk }), assignmentRows);

  const assetRequestRows = shuffle(activeEmployees)
    .slice(0, 8)
    .map((emp) => {
      const status = weightedPick<AssetRequestStatus>([
        [AssetRequestStatus.PENDING, 50], [AssetRequestStatus.APPROVED, 35], [AssetRequestStatus.REJECTED, 15],
      ]);
      return {
        employeeId: emp.id,
        assetCategory: pick(ASSET_CATALOG.map((c) => c.category)),
        justification: pick(['Existing device is faulty', 'New joiner setup', 'Upgrade request', 'Additional monitor for productivity']),
        status,
        approverId: status === AssetRequestStatus.PENDING ? null : hrAdmin.id,
        decidedAt: status === AssetRequestStatus.PENDING ? null : addDays(TODAY, -randomInt(1, 10)),
      };
    });
  await createManyChunked((chunk) => prisma.assetRequest.createMany({ data: chunk }), assetRequestRows);
  console.log(`  ${createdAssets.length} assets, ${assignmentRows.length} assignments, ${assetRequestRows.length} requests.`);

  // -------------------------------------------------------------------------
  // Helpdesk
  // -------------------------------------------------------------------------

  console.log('Creating helpdesk tickets...');

  const TICKET_TEMPLATES: { category: TicketCategory; subject: string; description: string }[] = [
    { category: TicketCategory.PAYROLL_QUERY, subject: 'Discrepancy in latest payslip', description: 'My last payslip shows a different amount than expected. Can someone check?' },
    { category: TicketCategory.PAYROLL_QUERY, subject: 'Reimbursement not credited', description: 'I submitted a travel reimbursement three weeks ago and it has not been credited yet.' },
    { category: TicketCategory.LEAVE_ATTENDANCE_ISSUE, subject: 'Attendance marked absent incorrectly', description: 'I was present on site but the system shows me absent for yesterday.' },
    { category: TicketCategory.LEAVE_ATTENDANCE_ISSUE, subject: 'Leave balance looks wrong', description: 'My leave balance does not reflect the leaves I took last month.' },
    { category: TicketCategory.IT_SUPPORT, subject: 'Laptop not booting', description: 'My work laptop is stuck on the boot screen since this morning.' },
    { category: TicketCategory.IT_SUPPORT, subject: 'VPN access request', description: 'I need VPN access set up to work from home this week.' },
    { category: TicketCategory.ADMIN_FACILITIES, subject: 'AC not working in the west wing', description: 'The air conditioning on the 3rd floor west wing has not been working since yesterday.' },
    { category: TicketCategory.ADMIN_FACILITIES, subject: 'Access card not working', description: 'My building access card stopped working at the main entrance.' },
    { category: TicketCategory.GENERAL_HR, subject: 'Question about the referral bonus policy', description: 'Can someone clarify the eligibility criteria for the employee referral bonus?' },
    { category: TicketCategory.GENERAL_HR, subject: 'Update to emergency contact details', description: 'I would like to update my emergency contact information on file.' },
  ];
  const SLA_HOURS_BY_PRIORITY: Record<TicketPriority, number> = {
    [TicketPriority.URGENT]: 4, [TicketPriority.HIGH]: 8, [TicketPriority.MEDIUM]: 24, [TicketPriority.LOW]: 48,
  };
  const agentPool = [hrAdmin, ...shuffle(allEmployees.filter((e) => e.role === Role.MANAGER)).slice(0, 4)];

  const ticketMessageRows: { ticketId: string; senderId: string; body: string; isInternalNote: boolean; createdAt: Date }[] = [];
  const TICKET_COUNT = 20;
  for (let i = 0; i < TICKET_COUNT; i++) {
    const template = pick(TICKET_TEMPLATES);
    const raiser = pick(activeEmployees);
    const priority = weightedPick<TicketPriority>([
      [TicketPriority.LOW, 25], [TicketPriority.MEDIUM, 45], [TicketPriority.HIGH, 22], [TicketPriority.URGENT, 8],
    ]);
    const status = weightedPick<TicketStatus>([
      [TicketStatus.OPEN, 25], [TicketStatus.IN_PROGRESS, 25], [TicketStatus.RESOLVED, 30],
      [TicketStatus.CLOSED, 15], [TicketStatus.REOPENED, 5],
    ]);
    const createdAt = addDays(TODAY, -randomInt(1, 30));
    const isTerminal = status === TicketStatus.RESOLVED || status === TicketStatus.CLOSED;
    const slaDueAt = addDays(createdAt, 0);
    slaDueAt.setUTCHours(slaDueAt.getUTCHours() + SLA_HOURS_BY_PRIORITY[priority]);
    const breached = isTerminal && Math.random() < 0.12;
    const agentId = agentPool.length ? pick(agentPool).id ?? hrAdmin.id : hrAdmin.id;

    const ticket = await prisma.ticket.create({
      data: {
        employeeId: raiser.id,
        category: template.category,
        priority,
        subject: template.subject,
        description: template.description,
        status,
        assignedAgentId: agentId,
        slaDueAt,
        slaBreachedAt: breached ? addDays(slaDueAt, 1) : null,
        resolutionNote: isTerminal ? 'Resolved after verifying with the relevant team; confirmed with the employee.' : null,
        resolvedAt: isTerminal ? addDays(createdAt, randomInt(1, 5)) : null,
        closedAt: status === TicketStatus.CLOSED ? addDays(createdAt, randomInt(2, 6)) : null,
        csatRating: status === TicketStatus.CLOSED ? randomInt(3, 5) : null,
        createdAt,
      },
    });
    manifest.ticketIds.push(ticket.id);

    ticketMessageRows.push({
      ticketId: ticket.id, senderId: raiser.id, body: template.description,
      isInternalNote: false, createdAt,
    });
    ticketMessageRows.push({
      ticketId: ticket.id, senderId: agentId, isInternalNote: false,
      body: pick([
        'Thanks for reaching out — looking into this now.',
        "We've escalated this to the right team, will update you shortly.",
        'Could you share a few more details so we can investigate faster?',
      ]),
      createdAt: addDays(createdAt, 1),
    });
    if (isTerminal) {
      ticketMessageRows.push({
        ticketId: ticket.id, senderId: agentId, isInternalNote: false,
        body: 'This has been resolved — please let us know if the issue comes back.',
        createdAt: addDays(createdAt, randomInt(2, 5)),
      });
    }
  }
  await createManyChunked((chunk) => prisma.ticketMessage.createMany({ data: chunk }), ticketMessageRows);
  console.log(`  ${TICKET_COUNT} tickets, ${ticketMessageRows.length} messages.`);

  // -------------------------------------------------------------------------
  // Announcements
  // -------------------------------------------------------------------------

  console.log('Creating announcements...');

  const ANNOUNCEMENTS: {
    title: string; body: string; scope: AnnouncementScope; deptCode?: string;
    priority: AnnouncementPriority; isPinned: boolean; requiresAck: boolean;
  }[] = [
    { title: 'Independence Day Holiday Schedule', body: "Reminder that our offices will be closed on August 15th for Independence Day. Regular business resumes the following working day.", scope: AnnouncementScope.ORGANIZATION, priority: AnnouncementPriority.MEDIUM, isPinned: true, requiresAck: false },
    { title: 'Updated Health Insurance Policy', body: 'We have rolled out an updated group health insurance policy with expanded coverage for dependents, effective this quarter. Please review the updated policy document and acknowledge receipt.', scope: AnnouncementScope.ORGANIZATION, priority: AnnouncementPriority.HIGH, isPinned: true, requiresAck: true },
    { title: 'Q3 All-Hands Recap', body: "Thank you to everyone who joined the Q3 all-hands. Slides and the recording are now available on the intranet.", scope: AnnouncementScope.ORGANIZATION, priority: AnnouncementPriority.LOW, isPinned: false, requiresAck: false },
    { title: 'Revised Work-From-Home Guidelines', body: 'Please review the revised hybrid work-from-home guidelines effective next month. This affects office attendance expectations for all teams.', scope: AnnouncementScope.ORGANIZATION, priority: AnnouncementPriority.MEDIUM, isPinned: false, requiresAck: true },
    { title: 'Employee Referral Bonus Increased', body: 'Great news — referral bonuses have been increased for all open roles. Check the careers page for currently open positions eligible for referral.', scope: AnnouncementScope.ORGANIZATION, priority: AnnouncementPriority.LOW, isPinned: false, requiresAck: false },
    { title: 'Engineering Sprint Planning Update', body: 'Starting next sprint, planning sessions move to Monday mornings. Please update your calendars accordingly.', scope: AnnouncementScope.DEPARTMENT, deptCode: 'ENG', priority: AnnouncementPriority.MEDIUM, isPinned: false, requiresAck: false },
    { title: 'Sales Kickoff — Save the Date', body: 'Our quarterly sales kickoff is scheduled for next month. Attendance is mandatory for all Sales team members.', scope: AnnouncementScope.DEPARTMENT, deptCode: 'SALES', priority: AnnouncementPriority.HIGH, isPinned: false, requiresAck: true },
    { title: 'New Support Ticketing Workflow', body: 'The Customer Support team is moving to an updated ticket triage workflow starting this week. Training sessions will be scheduled shortly.', scope: AnnouncementScope.DEPARTMENT, deptCode: 'CS', priority: AnnouncementPriority.MEDIUM, isPinned: false, requiresAck: false },
  ];

  for (const a of ANNOUNCEMENTS) {
    const createdAt = addDays(TODAY, -randomInt(1, 45));
    const announcement = await prisma.announcement.create({
      data: {
        companyId: company.id,
        title: a.title,
        body: a.body,
        scope: a.scope,
        departmentId: a.deptCode ? departmentByCode.get(a.deptCode)!.id : null,
        priority: a.priority,
        isPinned: a.isPinned,
        requiresAck: a.requiresAck,
        createdBy: hrAdmin.id,
        createdAt,
      },
    });
    manifest.announcementIds.push(announcement.id);

    if (a.requiresAck) {
      const targets = a.scope === AnnouncementScope.ORGANIZATION
        ? activeEmployees
        : activeEmployees.filter((e) => e.departmentCode === a.deptCode);
      const ackRows = targets.map((emp) => {
        const acknowledged = Math.random() < 0.65;
        return {
          announcementId: announcement.id,
          employeeId: emp.id,
          acknowledgedAt: acknowledged ? addDays(createdAt, randomInt(0, 5)) : null,
        };
      });
      await createManyChunked((chunk) => prisma.announcementAck.createMany({ data: chunk }), ackRows);
    }
  }
  console.log(`  ${ANNOUNCEMENTS.length} announcements created.`);

  // -------------------------------------------------------------------------
  // Manifest + summary
  // -------------------------------------------------------------------------

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log('');
  console.log('Demo data seed complete.');
  console.log(`  Employees:        ${manifest.employeeIds.length} (codes ${EMPLOYEE_CODE_PREFIX}0001..${EMPLOYEE_CODE_PREFIX}${String(seq - 1).padStart(4, '0')}, emails @${EMAIL_DOMAIN})`);
  console.log(`  Job requisitions: ${manifest.jobRequisitionIds.length}, candidates: ${manifest.candidateIds.length}`);
  console.log(`  Assets:           ${manifest.assetIds.length}`);
  console.log(`  Tickets:          ${manifest.ticketIds.length}`);
  console.log(`  Announcements:    ${manifest.announcementIds.length}`);
  console.log('');
  console.log('None of these employees have a password set — they are data, not login accounts.');
  console.log(`Manifest written to ${MANIFEST_PATH} — run \`npm run seed:demo:wipe\` before real rollout to remove exactly this batch.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
