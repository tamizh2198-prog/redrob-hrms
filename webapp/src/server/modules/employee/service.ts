import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { Prisma, Role, EmployeeStatus } from "@prisma/client";
import type { Employee, PrismaClient } from "@prisma/client";
import { hashPassword, verifyPassword, revokeAllRefreshTokensForEmployee } from "../../lib/auth";
import { notify } from "../../lib/notify";
import { sendEmail } from "../../lib/email";
import { getFrontendUrl } from "../../lib/frontend-url";
import { getOrCreateDefaultCompanyId } from "../../lib/default-company";
import { getReportingHierarchyIds } from "../../lib/reporting-hierarchy";
import { enforceRateLimit, recordRateLimitAttempt } from "../../lib/rate-limit";
import { encryptPiiNullable, decryptPiiNullable } from "../../lib/pii-crypto";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  ListEmployeesQueryDto,
  InviteEmployeeDto,
  UpdateMyProfileDto,
  ChangePasswordDto,
} from "./dto";
import { generateInvitationToken, hashInvitationToken } from "./invitation-token";
import { computeProfileCompletion } from "./profile-completion";
import { buildActiveEmployeesWorkbook } from "./employee-export";

const INVITATION_TTL_HOURS = 72;
const PASSWORD_RESET_TTL_HOURS = 24;

export type SafeEmployee = Omit<Employee, "passwordHash">;

export interface RequesterContext {
  userId?: string;
  role?: Role;
}

// Section 7.1 Business Rules: "Employee-submitted profile changes never
// write directly to the master record" — every field an employee can touch
// via update() lands as a ProfileChangeRequest for HR Admin review, never a
// direct write, regardless of how sensitive the field is.
export const SELF_SERVICE_FIELDS = [
  "dob",
  "personalEmail",
  "workEmail",
  "phone",
  "pan",
  "aadhaar",
  "bankAccountNumber",
  "ifscCode",
  "bloodGroup",
  "emergencyContactName",
  "emergencyContactPhone",
] as const satisfies readonly (keyof UpdateEmployeeDto)[];

// PIP/CURE_PERIOD are non-terminal — the employee is still working, so they
// count as active for payroll/analytics queries keyed on this constant.
export const ACTIVE_STATUSES: EmployeeStatus[] = [
  EmployeeStatus.ACTIVE,
  EmployeeStatus.ACTIVE_PROBATION,
  EmployeeStatus.PIP,
  EmployeeStatus.CURE_PERIOD,
];

const SENSITIVE_FIELDS = ["pan", "aadhaar", "bankAccountNumber"] as const;

// HRMS-11: these four are encrypted at rest (AES-256-GCM, see pii-crypto.ts)
// — every write path must encrypt on the way in, every read path that
// returns real (non-masked) values must decrypt on the way out.
const ENCRYPTED_FIELDS = ["pan", "aadhaar", "bankAccountNumber", "ifscCode"] as const;

function encryptSensitiveInput<T extends Partial<Record<(typeof ENCRYPTED_FIELDS)[number], string | null | undefined>>>(
  data: T,
): T {
  const out = { ...data };
  for (const field of ENCRYPTED_FIELDS) {
    if (field in out) {
      (out as Record<string, string | null | undefined>)[field] = encryptPiiNullable(out[field]);
    }
  }
  return out;
}

function decryptSensitiveEmployee<T extends Pick<Employee, (typeof ENCRYPTED_FIELDS)[number]>>(employee: T): T {
  const out = { ...employee };
  for (const field of ENCRYPTED_FIELDS) {
    (out as Record<string, string | null | undefined>)[field] = decryptPiiNullable(employee[field]);
  }
  return out;
}

// Every workEmail write goes through this so lookups (login, the
// invite/create uniqueness check) can rely on a consistent stored casing
// instead of needing case-insensitive matching everywhere a comparison
// happens.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// deleteEmployee(): full audit of every Employee foreign-key relationship in
// the schema, split into three handling strategies. Every employeeId-typed
// column in this schema is NOT NULL, so "nullable" here only ever applies
// to genuine secondary-role columns (String?), never to a row's own
// ownership column.

// 1. Employee-owned data — has no meaning or stakeholder once this specific
// employee is gone, and no other business process depends on the row
// surviving. Deleted along with the employee.
const EMPLOYEE_OWNED_MODELS = [
  "employeeInvitation",
  "passwordResetToken",
  "refreshToken",
  "trustedDevice",
  "employeeDocument",
  "employeeHistory",
  "profileChangeRequest",
  "rosterEntry",
  "employeeHybridSchedule",
  "optionalHolidaySelection",
  "wfoWfhChangeRequest",
  "onboardingChecklist",
  "preboardingSubmission",
  "probationFeedback",
  "newJoinerTracker",
  "learningRequest",
  "assetAssignment",
  "assetRequest",
  "exitInterview",
  "finalSettlement",
  "resignation",
  "announcementAck",
  "assistantConversation",
  "notification",
  "notificationPreference",
  "notificationLog",
] as const satisfies readonly (keyof PrismaClient)[];

// 2. Nullable secondary-role references — this employee is referenced as a
// manager/approver/agent on someone else's (or their own historical) row,
// but the column allows NULL, so the reference is safely cleared instead of
// blocking the delete or destroying the referencing row.
const NULLABLE_EMPLOYEE_REFERENCES: ReadonlyArray<{ model: string; field: string }> = [
  { model: "employee", field: "reportingManagerId" },
  { model: "assetRequest", field: "approverId" },
  { model: "ticketSlaPolicy", field: "agentId" },
  { model: "ticket", field: "assignedAgentId" },
  { model: "shiftSwapRequest", field: "approverId" },
  { model: "wfoWfhChangeRequest", field: "approverId" },
];

// 3. Required (NOT NULL) references to genuine business records with
// stakeholders beyond this one employee. Never deleted or force-nulled; if
// any exist, the delete is blocked with a specific, actionable error naming
// the model and row count.
const BLOCKING_EMPLOYEE_REFERENCES: ReadonlyArray<{ model: string; field: string; label: string }> = [
  { model: "goal", field: "employeeId", label: "performance goal" },
  { model: "review", field: "employeeId", label: "performance review" },
  { model: "monthlyEvaluation", field: "employeeId", label: "monthly performance evaluation" },
  { model: "ticket", field: "employeeId", label: "helpdesk ticket (raised by this employee)" },
  { model: "jobRequisition", field: "hiringManagerId", label: "job requisition (as hiring manager)" },
  { model: "interviewRound", field: "interviewerId", label: "interview round (as interviewer)" },
  { model: "shiftSwapRequest", field: "requesterId", label: "shift swap request (as requester)" },
  { model: "shiftSwapRequest", field: "counterpartId", label: "shift swap request (as counterpart)" },
  { model: "ticketMessage", field: "senderId", label: "helpdesk ticket message (as sender)" },
  { model: "announcement", field: "createdBy", label: "announcement (as creator)" },
  { model: "recognition", field: "senderId", label: "recognition (as sender)" },
  { model: "recognition", field: "recipientId", label: "recognition (as recipient)" },
  { model: "policyDocument", field: "uploadedById", label: "policy document (as uploader)" },
  { model: "savedReport", field: "createdById", label: "saved report (as creator)" },
  { model: "workflowDefinition", field: "createdById", label: "workflow definition (as creator)" },
  { model: "approvalRequest", field: "requestedById", label: "approval request (as requester)" },
  { model: "workflowApprovalDecision", field: "approverId", label: "workflow approval decision (as approver)" },
  { model: "superAdminRequestComment", field: "authorId", label: "super admin comment on a work request" },
];

function maskValue(value: string | null): string | null {
  if (!value) return value;
  const visible = value.slice(-4);
  return `****${visible}`;
}

// Every call site of this in the file is general access/data-entry, never
// an approve/reject decision, so HR_ASSOCIATE (mirrors HR_ADMIN except for
// decision authority) is safely included directly here.
function isPrivilegedRole(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN || role === Role.HR_ASSOCIATE;
}

// Reassigning any of these on an existing employee is Super Admin-only — an
// HR Admin can still edit every other privileged field via update() (CTC,
// PAN/bank details, contact info, etc.), just not these.
const SUPER_ADMIN_ONLY_FIELDS = [
  "reportingManagerId",
  "departmentId",
  "designationId",
  "gradeId",
  "locationId",
  "employmentType",
  "dateOfJoining",
  "status",
  "role",
] as const satisfies readonly (keyof UpdateEmployeeDto)[];

function stripPasswordHash(employee: Employee): SafeEmployee {
  const safe: Partial<Employee> = { ...employee };
  delete safe.passwordHash;
  return safe as SafeEmployee;
}

// Auth Phase 2 fix: passwordHash was never stripped from Employee API
// responses — this is the single choke point every read path already
// passes through, so removing it here closes that gap everywhere at once.
export function maskSensitiveFields(employee: Employee, requester: RequesterContext): SafeEmployee {
  const isSelf = requester.userId === employee.id;
  const safe = stripPasswordHash(employee);
  if (isPrivilegedRole(requester.role) || isSelf) {
    return safe;
  }
  const masked = { ...safe };
  for (const field of SENSITIVE_FIELDS) {
    masked[field] = maskValue(employee[field]);
  }
  // Compensation data — not string-shaped, so it isn't a maskValue
  // candidate; hidden outright rather than partially masked.
  masked.ctcLpa = null;
  return masked;
}

function assertMandatoryFieldsForActive(
  fields: {
    firstName?: string | null;
    lastName?: string | null;
    dob?: Date | string | null;
    gender?: string | null;
    departmentId?: string | null;
    designationId?: string | null;
    reportingManagerId?: string | null;
    dateOfJoining?: Date | string | null;
    pan?: string | null;
    bankAccountNumber?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
  },
  status: EmployeeStatus,
): void {
  if (!ACTIVE_STATUSES.includes(status)) return;

  const missing: string[] = [];
  if (!fields.firstName || !fields.lastName) missing.push("legal name");
  if (!fields.dob) missing.push("date of birth");
  if (!fields.gender) missing.push("gender");
  if (!fields.departmentId) missing.push("department");
  if (!fields.designationId) missing.push("designation");
  if (!fields.reportingManagerId) missing.push("reporting manager");
  if (!fields.dateOfJoining) missing.push("date of joining");
  if (!fields.pan) missing.push("PAN");
  if (!fields.bankAccountNumber) missing.push("bank account");
  if (!fields.emergencyContactName || !fields.emergencyContactPhone) {
    missing.push("emergency contact");
  }

  if (missing.length > 0) {
    throw new BadRequestError(`Missing mandatory fields for active status: ${missing.join(", ")}`);
  }
}

async function assertNoCircularManager(
  prisma: PrismaClient,
  employeeId: string | null,
  reportingManagerId: string | null | undefined,
): Promise<void> {
  if (!reportingManagerId) return;
  if (employeeId && reportingManagerId === employeeId) {
    throw new BadRequestError("An employee cannot be their own reporting manager");
  }
  if (!employeeId) return;

  let currentId: string | null = reportingManagerId;
  const visited = new Set<string>();
  while (currentId) {
    if (currentId === employeeId) {
      throw new BadRequestError("Circular reporting-manager assignment is not allowed");
    }
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const manager: { reportingManagerId: string | null } | null = await prisma.employee.findUnique({
      where: { id: currentId },
      select: { reportingManagerId: true },
    });
    currentId = manager?.reportingManagerId ?? null;
  }
}

const EMPLOYEE_CODE_PREFIX = "MNR";

async function generateEmployeeCode(prisma: PrismaClient): Promise<string> {
  // employeeCode is globally unique (not scoped per company), so the
  // sequence must be too. Derived from the MAX existing sequence number,
  // not a row count — see backend's employee.service.ts for the full
  // rationale (a count() would silently regenerate an already-taken code
  // after any gap).
  const year = new Date().getFullYear();
  const prefix = `${EMPLOYEE_CODE_PREFIX}-${year}-`;
  const last = await prisma.employee.findFirst({
    where: { employeeCode: { startsWith: prefix } },
    orderBy: { employeeCode: "desc" },
    select: { employeeCode: true },
  });
  const lastSeq = last ? parseInt(last.employeeCode.slice(prefix.length), 10) || 0 : 0;
  const seq = (lastSeq + 1).toString().padStart(4, "0");
  return `${prefix}${seq}`;
}

// Shared by create()/inviteEmployee() — both mint a fresh system-generated
// code and retry on the rare unique-constraint race rather than accepting
// one from the caller.
async function createEmployeeWithGeneratedCode(
  prisma: PrismaClient,
  buildData: (employeeCode: string) => Prisma.EmployeeCreateInput,
): Promise<Employee> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const employeeCode = await generateEmployeeCode(prisma);
    try {
      return await prisma.employee.create({ data: buildData(employeeCode) });
    } catch (err) {
      lastError = err;
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        continue;
      }
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Failed to create employee");
}

function toCreateData(
  dto: CreateEmployeeDto,
  companyId: string,
  employeeCode: string,
  status: EmployeeStatus,
): Prisma.EmployeeCreateInput {
  return {
    company: { connect: { id: companyId } },
    employeeCode,
    firstName: dto.firstName,
    lastName: dto.lastName,
    dob: dto.dob ? new Date(dto.dob) : undefined,
    gender: dto.gender,
    personalEmail: dto.personalEmail,
    workEmail: dto.workEmail ? normalizeEmail(dto.workEmail) : dto.workEmail,
    phone: dto.phone,
    department: dto.departmentId ? { connect: { id: dto.departmentId } } : undefined,
    designation: dto.designationId ? { connect: { id: dto.designationId } } : undefined,
    grade: dto.gradeId ? { connect: { id: dto.gradeId } } : undefined,
    location: dto.locationId ? { connect: { id: dto.locationId } } : undefined,
    reportingManager: dto.reportingManagerId ? { connect: { id: dto.reportingManagerId } } : undefined,
    dateOfJoining: dto.dateOfJoining ? new Date(dto.dateOfJoining) : undefined,
    employmentType: dto.employmentType,
    status,
    ...encryptSensitiveInput({
      pan: dto.pan,
      aadhaar: dto.aadhaar,
      bankAccountNumber: dto.bankAccountNumber,
      ifscCode: dto.ifscCode,
    }),
    bloodGroup: dto.bloodGroup,
    emergencyContactName: dto.emergencyContactName,
    emergencyContactPhone: dto.emergencyContactPhone,
    ctcLpa: dto.ctcLpa,
  };
}

// First-run setup only: creates the very first Super Admin account when the
// company has zero employees. Guarded solely by that employee.count() === 0
// check. Self-closing: the moment this succeeds once, the count is no
// longer zero and every subsequent call is rejected.
export async function bootstrapFirstSuperAdmin(
  prisma: PrismaClient,
  dto: { firstName: string; lastName: string; email: string; password: string },
): Promise<SafeEmployee> {
  const companyId = await getOrCreateDefaultCompanyId(prisma);
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  // Company.bootstrappedAt is the real guard — it survives a pilot data
  // reset (which wipes Employee to zero rows but never touches Company), so
  // the public, unauthenticated bootstrap endpoint can't reopen just because
  // someone later ran a reset. employee.count() is kept as defense in depth
  // for any company row that predates this flag.
  const existingCount = await prisma.employee.count();
  if (company?.bootstrappedAt || existingCount > 0) {
    if (!company?.bootstrappedAt) {
      await prisma.company.update({ where: { id: companyId }, data: { bootstrappedAt: new Date() } });
    }
    throw new ForbiddenError("Setup already completed — an employee account already exists.");
  }

  const passwordHash = await hashPassword(dto.password);
  const employee = await createEmployeeWithGeneratedCode(prisma, (employeeCode) => ({
    company: { connect: { id: companyId } },
    employeeCode,
    firstName: dto.firstName,
    lastName: dto.lastName,
    workEmail: normalizeEmail(dto.email),
    passwordHash,
    role: Role.SUPER_ADMIN,
    status: EmployeeStatus.ACTIVE,
  }));
  await prisma.company.update({ where: { id: companyId }, data: { bootstrappedAt: new Date() } });

  return stripPasswordHash(employee);
}

export async function create(prisma: PrismaClient, dto: CreateEmployeeDto, actorId: string): Promise<SafeEmployee> {
  const companyId = await getOrCreateDefaultCompanyId(prisma);
  const status = dto.status ?? EmployeeStatus.ACTIVE_PROBATION;

  assertMandatoryFieldsForActive(dto, status);
  await assertNoCircularManager(prisma, null, dto.reportingManagerId);

  const employee = await createEmployeeWithGeneratedCode(prisma, (employeeCode) =>
    toCreateData(dto, companyId, employeeCode, status),
  );

  await notify(prisma, {
    recipientId: employee.id,
    template: "employee.welcome",
    body: `Welcome, ${employee.firstName}! Your employee account has been created.`,
    data: { createdBy: actorId },
  });

  return stripPasswordHash(decryptSensitiveEmployee(employee));
}

// ---------------------------------------------------------------------
// Auth Phase 2: employee invitation + account activation. Deliberately
// separate from create() above — that method's mandatory-for-active field
// set doesn't apply to an invited-but-not-onboarded account.
// ---------------------------------------------------------------------

async function createInvitationToken(prisma: PrismaClient, employeeId: string) {
  const rawToken = generateInvitationToken();
  const tokenHash = hashInvitationToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60 * 1000);
  await prisma.employeeInvitation.create({ data: { employeeId, tokenHash, expiresAt } });
  return { rawToken, expiresAt };
}

async function sendInvitationEmail(
  firstName: string,
  email: string,
  rawToken: string,
  isResend: boolean,
): Promise<{ sent: boolean; invitationUrl: string }> {
  const baseUrl = getFrontendUrl();
  const invitationUrl = `${baseUrl}/activate-account?token=${rawToken}`;
  const result = await sendEmail({
    to: email,
    subject: "You are invited to Redrob HRMS",
    text: [
      `Hi ${firstName},`,
      "",
      isResend
        ? "Here is a new invitation link to activate your Redrob HRMS account."
        : "You have been invited to activate your Redrob HRMS account.",
      `Activate your account: ${invitationUrl}`,
      `This link expires in ${INVITATION_TTL_HOURS} hours.`,
      "",
      "If you were not expecting this invitation, you can ignore this email.",
    ].join("\n"),
  });
  return { sent: result.sent, invitationUrl };
}

// actorRole guards dto.role: without it, any HR_ADMIN able to call this
// endpoint could invite a new SUPER_ADMIN.
export async function inviteEmployee(
  prisma: PrismaClient,
  dto: InviteEmployeeDto,
  actorId: string,
  actorRole?: Role,
) {
  const normalizedEmail = normalizeEmail(dto.email);
  const existingByEmail = await prisma.employee.findFirst({
    where: { workEmail: { equals: normalizedEmail, mode: "insensitive" } },
  });
  if (existingByEmail) {
    throw new BadRequestError("An employee with this email already exists");
  }

  let role: Role | undefined;
  if (dto.role) {
    const isPrivilegedRoleRequested =
      dto.role === Role.SUPER_ADMIN || dto.role === Role.HR_ADMIN || dto.role === Role.HR_ASSOCIATE;
    if (isPrivilegedRoleRequested && actorRole !== Role.SUPER_ADMIN) {
      throw new ForbiddenError("Only a Super Admin can assign the HR Admin, HR Associate, or Super Admin role");
    }
    role = dto.role;
  }

  await assertNoCircularManager(prisma, null, dto.reportingManagerId);

  const companyId = await getOrCreateDefaultCompanyId(prisma);
  const employee = await createEmployeeWithGeneratedCode(prisma, (employeeCode) => ({
    company: { connect: { id: companyId } },
    employeeCode,
    firstName: dto.firstName,
    lastName: dto.lastName,
    workEmail: normalizedEmail,
    status: EmployeeStatus.INVITED,
    // role: EMPLOYEE (Prisma schema default) unless explicitly requested
    // and permitted above.
    role,
    department: dto.departmentId ? { connect: { id: dto.departmentId } } : undefined,
    location: dto.locationId ? { connect: { id: dto.locationId } } : undefined,
    reportingManager: dto.reportingManagerId ? { connect: { id: dto.reportingManagerId } } : undefined,
    designation: dto.designationId ? { connect: { id: dto.designationId } } : undefined,
    grade: dto.gradeId ? { connect: { id: dto.gradeId } } : undefined,
    employmentType: dto.employmentType,
    ctcLpa: dto.ctcLpa,
  }));

  const { rawToken, expiresAt } = await createInvitationToken(prisma, employee.id);
  const { sent: emailSent, invitationUrl } = await sendInvitationEmail(employee.firstName, dto.email, rawToken, false);

  await notify(prisma, {
    recipientId: employee.id,
    template: "employee.invited",
    body: `You've been invited to join. Check your email (${dto.email}) for your activation link.`,
    data: { invitedBy: actorId },
  });

  return {
    employee: stripPasswordHash(employee),
    invitation: { expiresAt },
    emailSent,
    invitationUrl: emailSent ? undefined : invitationUrl,
  };
}

export async function resendInvitation(prisma: PrismaClient, employeeId: string, actorId: string) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");
  if (employee.status !== EmployeeStatus.INVITED) {
    throw new BadRequestError("Only invited (not yet activated) employees can be re-invited");
  }
  if (!employee.workEmail) {
    throw new BadRequestError("This employee has no email on file to invite");
  }

  await prisma.employeeInvitation.deleteMany({ where: { employeeId, usedAt: null } });

  const { rawToken, expiresAt } = await createInvitationToken(prisma, employeeId);
  const { sent: emailSent, invitationUrl } = await sendInvitationEmail(
    employee.firstName,
    employee.workEmail,
    rawToken,
    true,
  );

  await notify(prisma, {
    recipientId: employee.id,
    template: "employee.invited",
    body: `Your invitation link has been resent. Check your email (${employee.workEmail}) for your activation link.`,
    data: { invitedBy: actorId, resend: true },
  });

  return { invitation: { expiresAt }, emailSent, invitationUrl: emailSent ? undefined : invitationUrl };
}

// Never a hard delete — Employee is historical HR data (performance rows
// all reference it by id). Reuses the existing TERMINATED status.
export async function dismissEmployee(prisma: PrismaClient, id: string, actorId: string): Promise<SafeEmployee> {
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) throw new NotFoundError("Employee not found");
  if (employee.status === EmployeeStatus.TERMINATED) {
    throw new BadRequestError("Employee is already terminated");
  }

  const [updated] = await prisma.$transaction([
    prisma.employee.update({ where: { id }, data: { status: EmployeeStatus.TERMINATED } }),
    prisma.employeeInvitation.deleteMany({ where: { employeeId: id, usedAt: null } }),
    prisma.employeeHistory.create({
      data: { employeeId: id, fieldChanged: "status", oldValue: employee.status, newValue: EmployeeStatus.TERMINATED, changedBy: actorId },
    }),
    // A dismissed employee's existing refresh token / trusted device
    // previously stayed valid for up to 30 more days — refreshSession() in
    // auth/service.ts now also checks status on every refresh, but revoking
    // here means it's dead immediately rather than on next refresh attempt.
    prisma.refreshToken.updateMany({ where: { employeeId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.trustedDevice.deleteMany({ where: { employeeId: id } }),
  ]);

  await notify(prisma, {
    recipientId: id,
    template: "employee.terminated",
    body: "Your employment has been marked as terminated.",
    data: { terminatedBy: actorId },
  });

  return stripPasswordHash(decryptSensitiveEmployee(updated));
}

// Ends probation — the only code path that can ever move ACTIVE_PROBATION ->
// ACTIVE (previously only possible via a generic, unaudited field edit).
// Also flips this employee's Confirmation Hamper tracker item to ASSIGNED —
// that item has no fixed day-offset (probation length varies), so it's
// driven by this event rather than the day-offset sweep that handles
// Joining Kit / ID Card.
export async function confirmEmployee(prisma: PrismaClient, id: string, actorId: string): Promise<SafeEmployee> {
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) throw new NotFoundError("Employee not found");
  if (employee.status !== EmployeeStatus.ACTIVE_PROBATION) {
    throw new BadRequestError("Only an employee currently in probation can be confirmed");
  }

  const [updated] = await prisma.$transaction([
    prisma.employee.update({ where: { id }, data: { status: EmployeeStatus.ACTIVE } }),
    prisma.employeeHistory.create({
      data: { employeeId: id, fieldChanged: "status", oldValue: employee.status, newValue: EmployeeStatus.ACTIVE, changedBy: actorId },
    }),
    prisma.newJoinerTracker.updateMany({
      where: { employeeId: id, item: "CONFIRMATION_HAMPER", status: "PENDING" },
      data: { status: "ASSIGNED", assignedAt: new Date() },
    }),
  ]);

  await notify(prisma, {
    recipientId: id,
    template: "employee.confirmed",
    body: "Congratulations — you've successfully completed your probation and are now a confirmed employee.",
    data: { confirmedBy: actorId },
  });

  return stripPasswordHash(decryptSensitiveEmployee(updated));
}

// placeOnPip / startCurePeriod: same shape as confirmEmployee — a
// dedicated, audited Super-Admin action rather than a generic status edit,
// since these carry real consequences beyond a plain field write. Neither
// is terminal (see ACTIVE_STATUSES above), so no invitation cleanup like
// dismissEmployee.
export async function placeOnPip(prisma: PrismaClient, id: string, actorId: string, reason?: string): Promise<SafeEmployee> {
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) throw new NotFoundError("Employee not found");
  if (employee.status === EmployeeStatus.TERMINATED || employee.status === EmployeeStatus.ARCHIVED) {
    throw new BadRequestError("This employee is no longer active");
  }

  const [updated] = await prisma.$transaction([
    prisma.employee.update({ where: { id }, data: { status: EmployeeStatus.PIP } }),
    prisma.employeeHistory.create({
      data: { employeeId: id, fieldChanged: "status", oldValue: employee.status, newValue: EmployeeStatus.PIP, changedBy: actorId },
    }),
  ]);

  await notify(prisma, {
    recipientId: id,
    template: "employee.pip-started",
    body: `You have been placed on a Performance Improvement Plan (PIP).${reason ? ` Reason: "${reason}"` : ""}`,
    data: { startedBy: actorId, reason },
  });

  return stripPasswordHash(decryptSensitiveEmployee(updated));
}

export async function startCurePeriod(prisma: PrismaClient, id: string, actorId: string, reason?: string): Promise<SafeEmployee> {
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) throw new NotFoundError("Employee not found");
  if (employee.status === EmployeeStatus.TERMINATED || employee.status === EmployeeStatus.ARCHIVED) {
    throw new BadRequestError("This employee is no longer active");
  }

  const [updated] = await prisma.$transaction([
    prisma.employee.update({ where: { id }, data: { status: EmployeeStatus.CURE_PERIOD } }),
    prisma.employeeHistory.create({
      data: { employeeId: id, fieldChanged: "status", oldValue: employee.status, newValue: EmployeeStatus.CURE_PERIOD, changedBy: actorId },
    }),
  ]);

  await notify(prisma, {
    recipientId: id,
    template: "employee.cure-period-started",
    body: `You have been placed under a Cure Period.${reason ? ` Reason: "${reason}"` : ""}`,
    data: { startedBy: actorId, reason },
  });

  return stripPasswordHash(decryptSensitiveEmployee(updated));
}

// Super Admin-only permanent removal, for test/development cleanup only —
// dismissEmployee (TERMINATED) remains the real-world offboarding path.
//
// Three-part strategy (see the constants above): (1) employee-owned rows
// are deleted with the employee, (2) nullable secondary-role references
// pointing at this employee are cleared to NULL, (3) required references to
// genuine business records are never deleted or force-nulled — if any
// exist, the whole operation is rejected up front.
export async function deleteEmployee(prisma: PrismaClient, id: string): Promise<{ deleted: true; employeeCode: string }> {
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) throw new NotFoundError("Employee not found");

  const prismaAny = prisma as unknown as Record<string, { count: (args: { where: Record<string, string> }) => Promise<number> }>;
  const blockers: string[] = [];
  for (const ref of BLOCKING_EMPLOYEE_REFERENCES) {
    const count = await prismaAny[ref.model].count({ where: { [ref.field]: id } });
    if (count > 0) {
      blockers.push(`a required ${ref.label} by ${count} record${count > 1 ? "s" : ""}`);
    }
  }
  if (blockers.length > 0) {
    throw new BadRequestError(
      `Cannot delete ${employee.firstName} ${employee.lastName}. The employee is referenced as ${blockers.join(", and ")}. Reassign or remove those references before deleting.`,
    );
  }

  // ~30 sequential round-trips below (NULLABLE_EMPLOYEE_REFERENCES +
  // EMPLOYEE_OWNED_MODELS loops, plus the grandchild lookups) can exceed
  // Prisma's 5s default interactive-transaction timeout over Supabase's
  // pooled connection, aborting mid-transaction with a "Transaction not
  // found... old closed transaction" (P2028) error — hence the explicit,
  // more generous timeout/maxWait below.
  await prisma.$transaction(async (tx) => {
    // Grandchild cleanup: several employee-owned models have their own
    // child rows that reference THEM — not the employee directly — so they
    // aren't covered by any employeeId-scoped deleteMany.
    const checklist = await tx.onboardingChecklist.findUnique({ where: { employeeId: id } });
    if (checklist) {
      await tx.checklistTask.deleteMany({ where: { checklistId: checklist.id } });
    }
    const resignation = await tx.resignation.findUnique({ where: { employeeId: id } });
    if (resignation) {
      await tx.clearanceItem.deleteMany({ where: { resignationId: resignation.id } });
      await tx.lwdAdjustment.deleteMany({ where: { resignationId: resignation.id } });
    }
    const conversations = await tx.assistantConversation.findMany({ where: { employeeId: id }, select: { id: true } });
    if (conversations.length > 0) {
      await tx.assistantMessage.deleteMany({ where: { conversationId: { in: conversations.map((c) => c.id) } } });
    }

    const txAny = tx as unknown as Record<
      string,
      {
        updateMany: (args: { where: Record<string, string>; data: Record<string, null> }) => Promise<unknown>;
        deleteMany: (args: { where: Record<string, string> }) => Promise<unknown>;
      }
    >;
    for (const ref of NULLABLE_EMPLOYEE_REFERENCES) {
      await txAny[ref.model].updateMany({ where: { [ref.field]: id }, data: { [ref.field]: null } });
    }
    for (const model of EMPLOYEE_OWNED_MODELS) {
      await txAny[model].deleteMany({ where: { employeeId: id } });
    }
    await tx.employee.delete({ where: { id } });
  }, { timeout: 20_000, maxWait: 10_000 });

  return { deleted: true, employeeCode: employee.employeeCode };
}

export function listPendingInvitations(prisma: PrismaClient) {
  return prisma.employeeInvitation.findMany({
    where: { usedAt: null },
    include: {
      employee: {
        select: { id: true, firstName: true, lastName: true, employeeCode: true, workEmail: true, status: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function findValidInvitationOrThrow(prisma: PrismaClient, rawToken: string) {
  const tokenHash = hashInvitationToken(rawToken);
  const invitation = await prisma.employeeInvitation.findUnique({
    where: { tokenHash },
    include: { employee: true },
  });
  if (!invitation) throw new NotFoundError("Invalid or expired invitation link");
  if (invitation.employee.status === EmployeeStatus.TERMINATED) {
    throw new BadRequestError("This invitation link is no longer valid");
  }
  if (invitation.usedAt) throw new BadRequestError("This invitation link has already been used");
  if (invitation.expiresAt < new Date()) throw new BadRequestError("This invitation link has expired");
  return invitation;
}

// Read-only check used by the public activation page to render the
// employee's name before they submit a password.
export async function validateInvitationToken(prisma: PrismaClient, rawToken: string) {
  const invitation = await findValidInvitationOrThrow(prisma, rawToken);
  return {
    firstName: invitation.employee.firstName,
    lastName: invitation.employee.lastName,
    employeeCode: invitation.employee.employeeCode,
    email: invitation.employee.workEmail,
    expiresAt: invitation.expiresAt,
  };
}

export interface ActivateAccountInput {
  token: string;
  password: string;
  confirmPassword: string;
}

// Security requirements (Auth Phase 2 #8): role/employeeCode/company/
// department/manager are never touched here — activation only ever sets
// passwordHash + status, both derived server-side.
export async function activateAccount(prisma: PrismaClient, dto: ActivateAccountInput): Promise<{ success: true }> {
  if (dto.password !== dto.confirmPassword) {
    throw new BadRequestError("Passwords do not match");
  }

  const invitation = await findValidInvitationOrThrow(prisma, dto.token);
  const passwordHash = await hashPassword(dto.password);

  await prisma.$transaction([
    prisma.employee.update({
      where: { id: invitation.employeeId },
      data: { passwordHash, status: EmployeeStatus.ACTIVE },
    }),
    prisma.employeeInvitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } }),
  ]);

  return { success: true };
}

// ---------------------------------------------------------------------
// Admin-assisted password reset + MFA reset, plus the interim
// self-service "Forgot password?" entry point.
// ---------------------------------------------------------------------

async function listPrivilegedIds(prisma: PrismaClient): Promise<string[]> {
  const admins = await prisma.employee.findMany({
    where: { role: { in: [Role.HR_ADMIN, Role.SUPER_ADMIN] } },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

// Always resolves with no return value regardless of whether the email
// matched anyone — the caller returns the same generic response either
// way, so this never leaks which emails exist in the system.
const FORGOT_PASSWORD_RATE_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 };

export async function forgotPassword(prisma: PrismaClient, email: string): Promise<void> {
  // Recorded on every call, not just matches — this is a public, unauthenticated
  // entry point (no account needed to hit it) that fans out a notification to
  // every privileged employee, so it's an email-bombing/spam vector on its own
  // regardless of whether the address exists.
  const rateLimitKey = `forgot-password:${email.trim().toLowerCase()}`;
  await enforceRateLimit(prisma, rateLimitKey, FORGOT_PASSWORD_RATE_LIMIT);
  await recordRateLimitAttempt(prisma, rateLimitKey);

  const employee = await prisma.employee.findFirst({
    where: { workEmail: { equals: email.trim(), mode: "insensitive" } },
  });
  if (!employee) return;

  const privilegedIds = await listPrivilegedIds(prisma);
  await Promise.all(
    privilegedIds.map((id) =>
      notify(prisma, {
        recipientId: id,
        template: "auth.password-reset-requested",
        body: `${employee.firstName} ${employee.lastName} (${employee.workEmail}) asked for help signing in — use Reset Password on their profile to send them a new link.`,
        data: { employeeId: employee.id },
      }),
    ),
  );
}

// Mirrors inviteEmployee's isPrivilegedRoleRequested gate: an HR Admin can
// reset password/MFA for ordinary staff, but only a Super Admin can do it
// for another HR Admin or Super Admin.
async function assertCanResetCredentials(prisma: PrismaClient, targetId: string, actorRole?: Role): Promise<Employee> {
  const target = await prisma.employee.findUnique({ where: { id: targetId } });
  if (!target) throw new NotFoundError("Employee not found");

  const targetIsPrivileged =
    target.role === Role.SUPER_ADMIN || target.role === Role.HR_ADMIN || target.role === Role.HR_ASSOCIATE;
  if (targetIsPrivileged && actorRole !== Role.SUPER_ADMIN) {
    throw new ForbiddenError("Only a Super Admin can reset credentials for an HR Admin, HR Associate, or Super Admin");
  }
  return target;
}

export async function resetPassword(
  prisma: PrismaClient,
  targetId: string,
  actorId: string,
  actorRole: Role | undefined,
): Promise<{ expiresAt: Date; emailSent: boolean; resetUrl?: string }> {
  const target = await assertCanResetCredentials(prisma, targetId, actorRole);
  if (!target.workEmail) {
    throw new BadRequestError("This employee has no work email on file to reset a password for");
  }

  await prisma.passwordResetToken.deleteMany({ where: { employeeId: targetId, usedAt: null } });

  const rawToken = generateInvitationToken();
  const tokenHash = hashInvitationToken(rawToken);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000);
  await prisma.passwordResetToken.create({ data: { employeeId: targetId, tokenHash, expiresAt } });

  const baseUrl = getFrontendUrl();
  const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;
  const result = await sendEmail({
    to: target.workEmail,
    subject: "Reset your Redrob HRMS password",
    text: [
      `Hi ${target.firstName},`,
      "",
      "A password reset was requested for your Redrob HRMS account.",
      `Reset your password: ${resetUrl}`,
      `This link expires in ${PASSWORD_RESET_TTL_HOURS} hours.`,
      "",
      "If you did not expect this, contact your HR Admin.",
    ].join("\n"),
  });

  await notify(prisma, {
    recipientId: targetId,
    template: "auth.password-reset",
    body: "A password reset was requested for your account by an HR Admin/Super Admin.",
    data: { resetBy: actorId },
  });

  return { expiresAt, emailSent: result.sent, resetUrl: result.sent ? undefined : resetUrl };
}

// Direct action, no token/link — clearing mfaSecret/mfaEnabled doesn't by
// itself grant access to anything; login's own logic re-enrolls MFA from
// scratch the next time this employee signs in.
export async function resetMfa(prisma: PrismaClient, targetId: string, actorRole: Role | undefined): Promise<{ success: true }> {
  await assertCanResetCredentials(prisma, targetId, actorRole);
  await prisma.employee.update({ where: { id: targetId }, data: { mfaSecret: null, mfaEnabled: false } });
  // A trusted device previously survived an MFA reset — it could keep
  // skipping MFA for up to 30 more days, defeating the point of the reset
  // (e.g. after a suspected compromise). Also kills any existing session so
  // a possibly-compromised device is signed out, not just MFA-downgraded.
  await revokeAllRefreshTokensForEmployee(prisma, targetId);
  await prisma.trustedDevice.deleteMany({ where: { employeeId: targetId } });
  await notify(prisma, {
    recipientId: targetId,
    template: "auth.mfa-reset",
    body: "Your MFA was reset by an HR Admin/Super Admin. You will be asked to set it up again next time you sign in.",
  });
  return { success: true };
}

async function findValidPasswordResetOrThrow(prisma: PrismaClient, rawToken: string) {
  const tokenHash = hashInvitationToken(rawToken);
  const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash }, include: { employee: true } });
  if (!reset) throw new NotFoundError("Invalid or expired password reset link");
  if (reset.employee.status === EmployeeStatus.TERMINATED) {
    throw new BadRequestError("This password reset link is no longer valid");
  }
  if (reset.usedAt) throw new BadRequestError("This password reset link has already been used");
  if (reset.expiresAt < new Date()) throw new BadRequestError("This password reset link has expired");
  return reset;
}

export async function validatePasswordResetToken(prisma: PrismaClient, rawToken: string) {
  const reset = await findValidPasswordResetOrThrow(prisma, rawToken);
  return {
    firstName: reset.employee.firstName,
    lastName: reset.employee.lastName,
    employeeCode: reset.employee.employeeCode,
    expiresAt: reset.expiresAt,
  };
}

export interface ConsumePasswordResetInput {
  token: string;
  password: string;
  confirmPassword: string;
}

export async function consumePasswordReset(prisma: PrismaClient, dto: ConsumePasswordResetInput): Promise<{ success: true }> {
  if (dto.password !== dto.confirmPassword) {
    throw new BadRequestError("Passwords do not match");
  }

  const reset = await findValidPasswordResetOrThrow(prisma, dto.token);
  const passwordHash = await hashPassword(dto.password);

  await prisma.$transaction([
    prisma.employee.update({ where: { id: reset.employeeId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    // Kills every existing session for this account — a password reset is
    // exactly the moment a stale/compromised session should stop working.
    prisma.refreshToken.updateMany({ where: { employeeId: reset.employeeId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  return { success: true };
}

// ---------------------------------------------------------------------
// Auth Phase 3: employee profile completion. employeeId always comes from
// the authenticated user — never from a param or body.
// ---------------------------------------------------------------------

export async function getMyProfile(prisma: PrismaClient, employeeId: string) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");

  return { employee: stripPasswordHash(employee), ...computeProfileCompletion(employee) };
}

// Deliberately a DIRECT write, not routed through the change-request/
// HR-approval path — profile completion is filling in blank fields that
// don't have an established value yet.
export async function updateMyProfile(prisma: PrismaClient, employeeId: string, dto: UpdateMyProfileDto) {
  const updated = await prisma.employee.update({
    where: { id: employeeId },
    data: {
      firstName: dto.firstName,
      lastName: dto.lastName,
      dob: dto.dob !== undefined ? new Date(dto.dob) : undefined,
      gender: dto.gender,
      phone: dto.phone,
      personalEmail: dto.personalEmail,
      addressLine: dto.addressLine,
      city: dto.city,
      state: dto.state,
      country: dto.country,
      postalCode: dto.postalCode,
      ...encryptSensitiveInput({
        pan: dto.pan,
        aadhaar: dto.aadhaar,
        bankAccountNumber: dto.bankAccountNumber,
        ifscCode: dto.ifscCode,
      }),
      bloodGroup: dto.bloodGroup,
      emergencyContactName: dto.emergencyContactName,
      emergencyContactPhone: dto.emergencyContactPhone,
      photoUrl: dto.photoUrl,
    },
  });

  // computeProfileCompletion only checks presence (null/undefined/"") on
  // these fields, which a ciphertext string satisfies identically to
  // plaintext — safe to run against either the encrypted or decrypted row.
  const decrypted = decryptSensitiveEmployee(updated);
  return { employee: stripPasswordHash(decrypted), ...computeProfileCompletion(decrypted) };
}

export async function changeMyPassword(prisma: PrismaClient, employeeId: string, dto: ChangePasswordDto) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");

  const currentPasswordMatches = !!employee.passwordHash && (await verifyPassword(dto.currentPassword, employee.passwordHash));
  if (!currentPasswordMatches) {
    throw new BadRequestError("Current password is incorrect");
  }

  if (dto.newPassword !== dto.confirmNewPassword) {
    throw new BadRequestError("New passwords do not match");
  }

  const passwordHash = await hashPassword(dto.newPassword);
  await prisma.employee.update({ where: { id: employeeId }, data: { passwordHash } });

  // consumePasswordReset (the forgot-password flow) already revokes
  // sessions on a password change — this in-session "change my password"
  // path didn't, leaving an intruder who knows the old password (but not
  // the new one) still fully signed in on every device.
  await revokeAllRefreshTokensForEmployee(prisma, employeeId);
  await prisma.trustedDevice.deleteMany({ where: { employeeId } });

  return { success: true };
}

export async function getReferenceData(prisma: PrismaClient) {
  const [departments, designations, grades, locations, managers] = await Promise.all([
    prisma.department.findMany({ where: { isActive: true } }),
    prisma.designation.findMany({ where: { isActive: true } }),
    prisma.grade.findMany({ where: { isActive: true } }),
    prisma.location.findMany({ where: { isActive: true } }),
    prisma.employee.findMany({
      select: { id: true, employeeCode: true, firstName: true, lastName: true, role: true, status: true },
      orderBy: { firstName: "asc" },
    }),
  ]);
  return { departments, designations, grades, locations, managers };
}

// Section 6 Access Control: unlike getReferenceData, this never includes
// the employee roster.
export async function getOrgLookup(prisma: PrismaClient) {
  const [departments, designations, locations] = await Promise.all([
    prisma.department.findMany({ where: { isActive: true } }),
    prisma.designation.findMany({ where: { isActive: true } }),
    prisma.location.findMany({ where: { isActive: true } }),
  ]);
  return { departments, designations, locations };
}

export async function exportActiveEmployees(prisma: PrismaClient): Promise<Buffer> {
  const employees = await prisma.employee.findMany({
    where: { status: { in: ACTIVE_STATUSES } },
    select: {
      employeeCode: true,
      firstName: true,
      lastName: true,
      workEmail: true,
      phone: true,
      employmentType: true,
      dateOfJoining: true,
      status: true,
      department: { select: { name: true } },
      designation: { select: { name: true } },
      location: { select: { name: true } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  return buildActiveEmployeesWorkbook(
    employees.map((e) => ({
      employeeCode: e.employeeCode,
      firstName: e.firstName,
      lastName: e.lastName,
      workEmail: e.workEmail,
      phone: e.phone,
      department: e.department?.name ?? null,
      designation: e.designation?.name ?? null,
      location: e.location?.name ?? null,
      employmentType: e.employmentType,
      dateOfJoining: e.dateOfJoining,
      status: e.status,
    })),
  );
}

// Section 6 Access Control: an Employee sees only their own record here —
// the shared directory list is an HR Admin/Super Admin/Manager surface.
export async function findAll(prisma: PrismaClient, query: ListEmployeesQueryDto, requester: RequesterContext) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;

  if (requester.role === Role.EMPLOYEE && requester.userId) {
    const self = await prisma.employee.findUnique({ where: { id: requester.userId } });
    const items = self ? [maskSensitiveFields(decryptSensitiveEmployee(self), requester)] : [];
    return { items, total: items.length, page: 1, pageSize };
  }

  // A Manager's directory is scoped to their own reporting tree.
  let scopedIds: string[] | undefined;
  if (requester.role === Role.MANAGER && requester.userId) {
    const teamIds = await getReportingHierarchyIds(prisma, requester.userId);
    scopedIds = [requester.userId, ...teamIds];
  } else if (!isPrivilegedRole(requester.role)) {
    // Explicit allowlist: only a privileged role reaches the unscoped
    // query below; every other non-manager, non-privileged role gets no
    // company-wide directory data.
    return { items: [], total: 0, page, pageSize };
  }

  const where: Prisma.EmployeeWhereInput = {
    ...(scopedIds && { id: { in: scopedIds } }),
    ...(query.departmentId && { departmentId: query.departmentId }),
    ...(query.locationId && { locationId: query.locationId }),
    ...(query.status && { status: query.status }),
    ...(query.search && {
      OR: [
        { firstName: { contains: query.search, mode: "insensitive" } },
        { lastName: { contains: query.search, mode: "insensitive" } },
        { employeeCode: { contains: query.search, mode: "insensitive" } },
      ],
    }),
  };

  const [items, total] = await Promise.all([
    prisma.employee.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: "desc" } }),
    prisma.employee.count({ where }),
  ]);

  return { items: items.map((e) => maskSensitiveFields(decryptSensitiveEmployee(e), requester)), total, page, pageSize };
}

// Section 6 Access Control Rule: "a Manager can only fetch records where
// employee.reporting_manager_id = self, recursively for indirect reports."
async function assertReadScope(prisma: PrismaClient, targetId: string, requester: RequesterContext): Promise<void> {
  if (isPrivilegedRole(requester.role)) return;
  if (requester.userId === targetId) return;
  if (requester.role === Role.MANAGER && requester.userId) {
    if (await isReportOf(prisma, targetId, requester.userId)) return;
  }
  throw new ForbiddenError("Not authorized to view this employee record");
}

async function isReportOf(prisma: PrismaClient, employeeId: string, managerId: string): Promise<boolean> {
  let currentId: string | null = employeeId;
  const visited = new Set<string>();
  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const emp: { reportingManagerId: string | null } | null = await prisma.employee.findUnique({
      where: { id: currentId },
      select: { reportingManagerId: true },
    });
    currentId = emp?.reportingManagerId ?? null;
    if (currentId === managerId) return true;
  }
  return false;
}

export async function findOne(prisma: PrismaClient, id: string, requester: RequesterContext): Promise<SafeEmployee> {
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) throw new NotFoundError("Employee not found");
  await assertReadScope(prisma, id, requester);
  return maskSensitiveFields(decryptSensitiveEmployee(employee), requester);
}

export async function getProfileCompletionForEmployee(prisma: PrismaClient, id: string, requester: RequesterContext) {
  await assertReadScope(prisma, id, requester);
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) throw new NotFoundError("Employee not found");
  return computeProfileCompletion(employee);
}

export async function revealSensitiveFields(prisma: PrismaClient, id: string, requester: RequesterContext) {
  const isSelf = requester.userId === id;
  if (!isPrivilegedRole(requester.role) && !isSelf) {
    throw new ForbiddenError();
  }
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) throw new NotFoundError("Employee not found");
  const decrypted = decryptSensitiveEmployee(employee);
  return { pan: decrypted.pan, aadhaar: decrypted.aadhaar, bankAccountNumber: decrypted.bankAccountNumber };
}

function diffForHistory(
  employee: Employee,
  dto: UpdateEmployeeDto,
  changedBy?: string,
): Prisma.EmployeeHistoryCreateManyInput[] {
  const entries: Prisma.EmployeeHistoryCreateManyInput[] = [];
  const trackedFields = [
    "firstName",
    "lastName",
    "departmentId",
    "designationId",
    "gradeId",
    "locationId",
    "reportingManagerId",
    "employmentType",
    "status",
    "role",
  ] as const;

  for (const field of trackedFields) {
    const newValue = dto[field];
    if (newValue === undefined) continue;
    const oldValue = employee[field];
    if (String(oldValue ?? "") === String(newValue ?? "")) continue;
    entries.push({
      employeeId: employee.id,
      fieldChanged: field,
      oldValue: oldValue != null ? String(oldValue) : null,
      newValue: newValue != null ? String(newValue) : null,
      changedBy: changedBy ?? "system",
    });
  }
  return entries;
}

async function createChangeRequestsFromDto(prisma: PrismaClient, employeeId: string, dto: UpdateEmployeeDto) {
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });

  const toCreate: Prisma.ProfileChangeRequestCreateManyInput[] = [];
  for (const field of SELF_SERVICE_FIELDS) {
    const newValue = dto[field];
    if (newValue === undefined) continue;
    const rawOldValue = employee[field];
    // HRMS-11: pan/aadhaar/bankAccountNumber/ifscCode are stored encrypted
    // — decrypt the stored value before comparing against the DTO's
    // plaintext, then re-encrypt both sides before persisting so this
    // pending-approval row never holds plaintext.
    const isEncryptedField = (ENCRYPTED_FIELDS as readonly string[]).includes(field);
    // dob is a Date on the record but a plain "YYYY-MM-DD" string on the
    // DTO — normalize before comparing/storing.
    const oldValue = rawOldValue instanceof Date
      ? rawOldValue.toISOString().slice(0, 10)
      : isEncryptedField
        ? decryptPiiNullable(rawOldValue as string | null)
        : rawOldValue;
    if (String(oldValue ?? "") === String(newValue ?? "")) continue;
    const oldValueString = oldValue != null ? String(oldValue) : null;
    const newValueString = String(newValue);
    toCreate.push({
      employeeId,
      fieldName: field,
      oldValue: isEncryptedField ? encryptPiiNullable(oldValueString) ?? null : oldValueString,
      newValue: isEncryptedField ? encryptPiiNullable(newValueString) ?? newValueString : newValueString,
    });
  }

  if (toCreate.length === 0) {
    return { changeRequestsCreated: 0 };
  }

  await prisma.profileChangeRequest.createMany({ data: toCreate });

  await notify(prisma, {
    recipientId: "hr-admin",
    template: "profile-change.submitted",
    body: `${employee.firstName} ${employee.lastName} submitted a profile change request for: ${toCreate.map((c) => c.fieldName).join(", ")}.`,
    data: { employeeId, fields: toCreate.map((c) => c.fieldName) },
  });

  return { changeRequestsCreated: toCreate.length };
}

export async function update(prisma: PrismaClient, id: string, dto: UpdateEmployeeDto, requester: RequesterContext) {
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) throw new NotFoundError("Employee not found");

  const isSelf = requester.userId === id;
  if (!isPrivilegedRole(requester.role)) {
    if (!isSelf) throw new ForbiddenError();
    return createChangeRequestsFromDto(prisma, id, dto);
  }

  // These 9 fields are Super Admin-only.
  const superAdminOnlyFieldsTouched = SUPER_ADMIN_ONLY_FIELDS.some((field) => dto[field] !== undefined);
  if (superAdminOnlyFieldsTouched && requester.role !== Role.SUPER_ADMIN) {
    throw new ForbiddenError(
      "Only a Super Admin can change reporting manager, department, designation, grade, location, employment type, date of joining, status, or role",
    );
  }

  if (dto.reportingManagerId !== undefined) {
    await assertNoCircularManager(prisma, id, dto.reportingManagerId);
  }

  // Only re-validate when this update is actually transitioning the
  // employee's status — not on every subsequent edit of someone already
  // active.
  if (dto.status !== undefined && dto.status !== employee.status) {
    assertMandatoryFieldsForActive({ ...employee, ...dto }, dto.status);
  }

  const historyData = diffForHistory(employee, dto, requester.userId);

  const updated = await prisma.employee.update({
    where: { id },
    data: {
      firstName: dto.firstName,
      lastName: dto.lastName,
      dob: dto.dob ? new Date(dto.dob) : undefined,
      gender: dto.gender,
      personalEmail: dto.personalEmail,
      workEmail: dto.workEmail ? normalizeEmail(dto.workEmail) : dto.workEmail,
      phone: dto.phone,
      departmentId: dto.departmentId,
      designationId: dto.designationId,
      gradeId: dto.gradeId,
      locationId: dto.locationId,
      reportingManagerId: dto.reportingManagerId,
      dateOfJoining: dto.dateOfJoining ? new Date(dto.dateOfJoining) : undefined,
      employmentType: dto.employmentType,
      status: dto.status,
      role: dto.role,
      ...encryptSensitiveInput({
        pan: dto.pan,
        aadhaar: dto.aadhaar,
        bankAccountNumber: dto.bankAccountNumber,
        ifscCode: dto.ifscCode,
      }),
      bloodGroup: dto.bloodGroup,
      emergencyContactName: dto.emergencyContactName,
      emergencyContactPhone: dto.emergencyContactPhone,
      ctcLpa: dto.ctcLpa,
    },
  });

  if (historyData.length > 0) {
    await prisma.employeeHistory.createMany({ data: historyData });
  }

  return maskSensitiveFields(decryptSensitiveEmployee(updated), requester);
}

export async function approveChangeRequest(prisma: PrismaClient, requestId: string, reviewerId: string) {
  const request = await prisma.profileChangeRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new NotFoundError("Change request not found");
  if (request.status !== "PENDING") {
    throw new BadRequestError("Change request already reviewed");
  }

  await prisma.$transaction([
    prisma.employee.update({
      where: { id: request.employeeId },
      data: {
        // ProfileChangeRequest.newValue is always a plain string — dob is
        // the one self-service field that isn't a String column.
        [request.fieldName]: request.fieldName === "dob" ? new Date(request.newValue) : request.newValue,
      },
    }),
    prisma.employeeHistory.create({
      data: {
        employeeId: request.employeeId,
        fieldChanged: request.fieldName,
        oldValue: request.oldValue,
        newValue: request.newValue,
        changedBy: reviewerId,
      },
    }),
    prisma.profileChangeRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", reviewedBy: reviewerId, reviewedAt: new Date() },
    }),
  ]);

  await notify(prisma, {
    recipientId: request.employeeId,
    template: "profile-change.approved",
    body: `Your request to update ${request.fieldName} was approved.`,
  });
}

export async function rejectChangeRequest(prisma: PrismaClient, requestId: string, reviewerId: string, reason?: string) {
  const request = await prisma.profileChangeRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new NotFoundError("Change request not found");
  if (request.status !== "PENDING") {
    throw new BadRequestError("Change request already reviewed");
  }

  await prisma.profileChangeRequest.update({
    where: { id: requestId },
    data: { status: "REJECTED", reviewedBy: reviewerId, reviewedAt: new Date(), rejectionReason: reason },
  });

  await notify(prisma, {
    recipientId: request.employeeId,
    template: "profile-change.rejected",
    body: `Your request to update ${request.fieldName} was rejected.${reason ? ` Comment: "${reason}"` : ""}`,
    data: { reason },
  });
}

export async function listChangeRequests(prisma: PrismaClient, status?: "PENDING" | "APPROVED" | "REJECTED") {
  const requests = await prisma.profileChangeRequest.findMany({
    where: status ? { status } : undefined,
    include: { employee: true },
    orderBy: { requestedAt: "desc" },
  });

  // HRMS-11: both the request's own old/new value (when it's for one of the
  // encrypted fields) and the included employee's four fields come back as
  // ciphertext — decrypt before returning to the HR-Admin review UI.
  const isEncryptedField = (field: string) => (ENCRYPTED_FIELDS as readonly string[]).includes(field);
  return requests.map((request) => ({
    ...request,
    oldValue: isEncryptedField(request.fieldName) ? decryptPiiNullable(request.oldValue) ?? null : request.oldValue,
    newValue: isEncryptedField(request.fieldName)
      ? decryptPiiNullable(request.newValue) ?? request.newValue
      : request.newValue,
    employee: decryptSensitiveEmployee(request.employee),
  }));
}

export async function getOrgChart(prisma: PrismaClient, id: string, requester: RequesterContext) {
  await assertReadScope(prisma, id, requester);
  const employee = await prisma.employee.findUnique({ where: { id }, include: { directReports: true } });
  if (!employee) throw new NotFoundError("Employee not found");

  const managers: Employee[] = [];
  let currentManagerId = employee.reportingManagerId;
  while (currentManagerId) {
    const manager: Employee | null = await prisma.employee.findUnique({ where: { id: currentManagerId } });
    if (!manager) break;
    managers.push(manager);
    currentManagerId = manager.reportingManagerId;
  }

  const toBasicProfile = (e: Employee) => ({
    id: e.id,
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    lastName: e.lastName,
    designationId: e.designationId,
  });

  return {
    employee: toBasicProfile(employee),
    managers: managers.map(toBasicProfile),
    directReports: employee.directReports.map(toBasicProfile),
  };
}

// Self-scoped by construction (always the caller's own department) — no
// role gate needed, reachable by every role including plain EMPLOYEE.
export async function getMyDepartmentColleagues(prisma: PrismaClient, requesterId: string) {
  const requester = await prisma.employee.findUnique({ where: { id: requesterId }, select: { departmentId: true } });
  if (!requester?.departmentId) return [];

  return prisma.employee.findMany({
    where: { departmentId: requester.departmentId, id: { not: requesterId } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      status: true,
      designation: { select: { name: true } },
    },
    orderBy: { firstName: "asc" },
  });
}

async function validateRow(row: CreateEmployeeDto): Promise<string[]> {
  const instance = plainToInstance(CreateEmployeeDto, row);
  const errors = await validate(instance);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

export async function bulkImport(prisma: PrismaClient, rows: CreateEmployeeDto[], dryRun: boolean, actorId: string) {
  const results: Array<{ row: number; success: boolean; employeeId?: string; errors?: string[] }> = [];

  for (const [index, row] of rows.entries()) {
    const errors = await validateRow(row);
    if (errors.length > 0) {
      results.push({ row: index, success: false, errors });
      continue;
    }

    try {
      const status = row.status ?? EmployeeStatus.ACTIVE_PROBATION;
      assertMandatoryFieldsForActive(row, status);
      if (!dryRun) {
        const created = await create(prisma, row, actorId);
        results.push({ row: index, success: true, employeeId: created.id });
      } else {
        results.push({ row: index, success: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({ row: index, success: false, errors: [message] });
    }
  }

  return {
    totalRows: rows.length,
    successCount: results.filter((r) => r.success).length,
    failureCount: results.filter((r) => !r.success).length,
    dryRun,
    results,
  };
}
