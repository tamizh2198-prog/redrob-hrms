import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Employee, EmployeeStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { EmailService } from '../../shared/email/email.service';
import { hashPassword, verifyPassword } from '../../shared/auth/password.util';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { InviteEmployeeDto } from './dto/invite-employee.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import type { ActivateAccountDto } from '../../shared/auth/dto/activate-account.dto';
import type { ConsumePasswordResetDto } from '../../shared/auth/dto/consume-password-reset.dto';
import { RequesterContext, SELF_SERVICE_FIELDS } from './employee.types';
import {
  generateInvitationToken,
  hashInvitationToken,
} from './invitation-token.util';
import { computeProfileCompletion } from './profile-completion.util';
import { getReportingHierarchyIds } from '../../shared/employee/reporting-hierarchy.util';
import { buildActiveEmployeesWorkbook } from './employee-export.util';

const INVITATION_TTL_HOURS = 72;
const PASSWORD_RESET_TTL_HOURS = 24;

type SafeEmployee = Omit<Employee, 'passwordHash'>;

export const ACTIVE_STATUSES: EmployeeStatus[] = [
  EmployeeStatus.ACTIVE,
  EmployeeStatus.ACTIVE_PROBATION,
];

const SENSITIVE_FIELDS = ['pan', 'aadhaar', 'bankAccountNumber'] as const;

// Every workEmail write goes through this so lookups (login, the
// invite/create uniqueness check) can rely on a consistent stored casing
// instead of needing case-insensitive matching everywhere a comparison
// happens. Found live: a user typed a different case at login than what
// got saved when the email was set via the admin edit form, and got
// "Invalid credentials" despite it being the "same" email to a person.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// deleteEmployee(): full audit of every Employee foreign-key relationship in
// the schema, split into three handling strategies. Every employeeId-typed
// column in this schema is NOT NULL (verified against schema.prisma), so
// "nullable" here only ever applies to genuine secondary-role columns
// (`String?`), never to a row's own ownership column.

// 1. Employee-owned data — has no meaning or stakeholder once this specific
// employee is gone, and no other business process depends on the row
// surviving. Deleted along with the employee.
//
// Order matters: exitInterview/finalSettlement each hold their own FK to
// Resignation (resignationId), so they must be cleared before resignation
// itself — deleteEmployee() also explicitly clears ClearanceItem/
// LwdAdjustment (which reference Resignation, not Employee, so they aren't
// employeeId-scoped at all) and ChecklistTask (which references
// OnboardingChecklist) before this loop runs, for the same reason.
const EMPLOYEE_OWNED_MODELS = [
  'employeeInvitation',
  'passwordResetToken',
  'refreshToken',
  'employeeDocument',
  'employeeHistory',
  'profileChangeRequest',
  'rosterEntry',
  'employeeHybridSchedule',
  'optionalHolidaySelection',
  'wfoWfhChangeRequest',
  'onboardingChecklist',
  'preboardingSubmission',
  'probationFeedback',
  'learningRequest',
  'assetAssignment',
  'assetRequest',
  'exitInterview',
  'finalSettlement',
  'resignation',
  'announcementAck',
  'assistantConversation',
  'notification',
  'notificationPreference',
  'notificationLog',
] as const satisfies readonly (keyof PrismaService)[];

// 2. Nullable secondary-role references — this employee is referenced as a
// manager/approver/agent on someone else's (or their own historical) row,
// but the column allows NULL, so the reference is safely cleared instead of
// blocking the delete or destroying the referencing row. The self-relation
// (other employees who report to this one) is handled the same way.
// ShiftSwapRequest.approverId has no Prisma `@relation` (a loose string
// column, not FK-enforced) but is still cleared for data hygiene.
const NULLABLE_EMPLOYEE_REFERENCES: ReadonlyArray<{
  model: keyof PrismaService;
  field: string;
}> = [
  { model: 'employee', field: 'reportingManagerId' },
  { model: 'assetRequest', field: 'approverId' },
  { model: 'ticketSlaPolicy', field: 'agentId' },
  { model: 'ticket', field: 'assignedAgentId' },
  { model: 'shiftSwapRequest', field: 'approverId' },
  { model: 'wfoWfhChangeRequest', field: 'approverId' },
];

// 3. Required (NOT NULL) references to genuine business records with
// stakeholders beyond this one employee — job requisitions, tickets,
// announcements, performance records, recognitions, policy documents,
// reports, and workflow history. These are never deleted or force-nulled;
// if any exist, the delete is blocked with a specific, actionable error
// naming the model and row count (Section: error handling).
const BLOCKING_EMPLOYEE_REFERENCES: ReadonlyArray<{
  model: keyof PrismaService;
  field: string;
  label: string;
}> = [
  { model: 'goal', field: 'employeeId', label: 'performance goal' },
  { model: 'review', field: 'employeeId', label: 'performance review' },
  {
    model: 'monthlyEvaluation',
    field: 'employeeId',
    label: 'monthly performance evaluation',
  },
  {
    model: 'quarterlyKpi',
    field: 'employeeId',
    label: 'quarterly KPI evaluation',
  },
  { model: 'ticket', field: 'employeeId', label: 'helpdesk ticket (raised by this employee)' },
  {
    model: 'jobRequisition',
    field: 'hiringManagerId',
    label: 'job requisition (as hiring manager)',
  },
  {
    model: 'interviewRound',
    field: 'interviewerId',
    label: 'interview round (as interviewer)',
  },
  {
    model: 'shiftSwapRequest',
    field: 'requesterId',
    label: 'shift swap request (as requester)',
  },
  {
    model: 'shiftSwapRequest',
    field: 'counterpartId',
    label: 'shift swap request (as counterpart)',
  },
  {
    model: 'ticketMessage',
    field: 'senderId',
    label: 'helpdesk ticket message (as sender)',
  },
  { model: 'announcement', field: 'createdBy', label: 'announcement (as creator)' },
  { model: 'recognition', field: 'senderId', label: 'recognition (as sender)' },
  { model: 'recognition', field: 'recipientId', label: 'recognition (as recipient)' },
  {
    model: 'policyDocument',
    field: 'uploadedById',
    label: 'policy document (as uploader)',
  },
  { model: 'savedReport', field: 'createdById', label: 'saved report (as creator)' },
  {
    model: 'workflowDefinition',
    field: 'createdById',
    label: 'workflow definition (as creator)',
  },
  {
    model: 'approvalRequest',
    field: 'requestedById',
    label: 'approval request (as requester)',
  },
  {
    model: 'workflowApprovalDecision',
    field: 'approverId',
    label: 'workflow approval decision (as approver)',
  },
  {
    model: 'superAdminRequestComment',
    field: 'authorId',
    label: 'super admin comment on a work request',
  },
];

function maskValue(value: string | null): string | null {
  if (!value) return value;
  const visible = value.slice(-4);
  return `****${visible}`;
}

function isPrivilegedRole(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
}

// Reassigning any of these on an existing employee is Super Admin-only —
// an HR Admin can still edit every other privileged field via update()
// (CTC, PAN/bank details, contact info, etc.), just not these.
const SUPER_ADMIN_ONLY_FIELDS = [
  'reportingManagerId',
  'departmentId',
  'designationId',
  'gradeId',
  'locationId',
  'employmentType',
  'dateOfJoining',
  'status',
] as const satisfies readonly (keyof UpdateEmployeeDto)[];

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly email: EmailService,
  ) {}

  // Auth Phase 2 fix: passwordHash (added in Auth Phase 1) was never
  // stripped from Employee API responses — this is the single choke point
  // every read path (findAll/findOne/update, and now invite) already
  // passes through, so removing it here closes that gap everywhere at once
  // without changing any other field.
  maskSensitiveFields(
    employee: Employee,
    requester: RequesterContext,
  ): SafeEmployee {
    const isSelf = requester.userId === employee.id;
    const safe = this.stripPasswordHash(employee);
    if (isPrivilegedRole(requester.role) || isSelf) {
      return safe;
    }
    const masked = { ...safe };
    for (const field of SENSITIVE_FIELDS) {
      masked[field] = maskValue(employee[field]);
    }
    // Compensation data — not string-shaped, so it isn't a MaskValue
    // candidate; hidden outright rather than partially masked (there's no
    // meaningful "last 4 digits" for a salary figure).
    masked.ctcLpa = null;
    return masked;
  }

  private stripPasswordHash(employee: Employee): SafeEmployee {
    const safe: Partial<Employee> = { ...employee };
    delete safe.passwordHash;
    return safe as SafeEmployee;
  }

  private assertMandatoryFieldsForActive(
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
    if (!fields.firstName || !fields.lastName) missing.push('legal name');
    if (!fields.dob) missing.push('date of birth');
    if (!fields.gender) missing.push('gender');
    if (!fields.departmentId) missing.push('department');
    if (!fields.designationId) missing.push('designation');
    if (!fields.reportingManagerId) missing.push('reporting manager');
    if (!fields.dateOfJoining) missing.push('date of joining');
    if (!fields.pan) missing.push('PAN');
    if (!fields.bankAccountNumber) missing.push('bank account');
    if (!fields.emergencyContactName || !fields.emergencyContactPhone) {
      missing.push('emergency contact');
    }

    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing mandatory fields for active status: ${missing.join(', ')}`,
      );
    }
  }

  private async assertNoCircularManager(
    employeeId: string | null,
    reportingManagerId: string | null | undefined,
  ): Promise<void> {
    if (!reportingManagerId) return;
    if (employeeId && reportingManagerId === employeeId) {
      throw new BadRequestException(
        'An employee cannot be their own reporting manager',
      );
    }
    if (!employeeId) return;

    let currentId: string | null = reportingManagerId;
    const visited = new Set<string>();
    while (currentId) {
      if (currentId === employeeId) {
        throw new BadRequestException(
          'Circular reporting-manager assignment is not allowed',
        );
      }
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const manager: { reportingManagerId: string | null } | null =
        await this.prisma.employee.findUnique({
          where: { id: currentId },
          select: { reportingManagerId: true },
        });
      currentId = manager?.reportingManagerId ?? null;
    }
  }

  private async getDefaultCompanyId(): Promise<string> {
    const existing = await this.prisma.company.findFirst();
    if (existing) return existing.id;
    const created = await this.prisma.company.create({
      data: { name: 'Default Company' },
    });
    return created.id;
  }

  private static readonly EMPLOYEE_CODE_PREFIX = 'MNR';

  private async generateEmployeeCode(): Promise<string> {
    // employeeCode is globally unique (not scoped per company), so the
    // sequence must be too — counting per-company here would keep
    // recomputing the same already-taken code for every new company.
    //
    // Derived from the MAX existing sequence number, not a row count: a
    // count() undercounts the instant any code in this year's range is
    // deleted (or never existed, e.g. a manually-entered legacy code sitting
    // in a gap), silently regenerating an already-taken code. Since the
    // failed create doesn't change what count() returns, every retry in
    // createEmployeeWithGeneratedCode() recomputed the exact same colliding
    // code and all 3 attempts failed identically (P2002 on employeeCode,
    // surfaced to the user as a 500). Sorting by employeeCode works because
    // the zero-padded 4-digit suffix keeps every code in this prefix the
    // same length, so lexicographic and numeric order agree.
    const year = new Date().getFullYear();
    const prefix = `${EmployeeService.EMPLOYEE_CODE_PREFIX}-${year}-`;
    const last = await this.prisma.employee.findFirst({
      where: { employeeCode: { startsWith: prefix } },
      orderBy: { employeeCode: 'desc' },
      select: { employeeCode: true },
    });
    const lastSeq = last ? parseInt(last.employeeCode.slice(prefix.length), 10) || 0 : 0;
    const seq = (lastSeq + 1).toString().padStart(4, '0');
    return `${prefix}${seq}`;
  }

  // Shared by create()/inviteEmployee() — both mint a fresh system-generated
  // code and retry on the rare unique-constraint race rather than accepting
  // one from the caller (employeeCode is system-generated and immutable,
  // Section 7.1 Business Rules).
  private async createEmployeeWithGeneratedCode(
    buildData: (employeeCode: string) => Prisma.EmployeeCreateInput,
  ): Promise<Employee> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const employeeCode = await this.generateEmployeeCode();
      try {
        return await this.prisma.employee.create({
          data: buildData(employeeCode),
        });
      } catch (err) {
        lastError = err;
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          continue;
        }
        throw err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Failed to create employee');
  }

  private toCreateData(
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
      department: dto.departmentId
        ? { connect: { id: dto.departmentId } }
        : undefined,
      designation: dto.designationId
        ? { connect: { id: dto.designationId } }
        : undefined,
      grade: dto.gradeId ? { connect: { id: dto.gradeId } } : undefined,
      location: dto.locationId
        ? { connect: { id: dto.locationId } }
        : undefined,
      reportingManager: dto.reportingManagerId
        ? { connect: { id: dto.reportingManagerId } }
        : undefined,
      dateOfJoining: dto.dateOfJoining
        ? new Date(dto.dateOfJoining)
        : undefined,
      employmentType: dto.employmentType,
      status,
      pan: dto.pan,
      aadhaar: dto.aadhaar,
      bankAccountNumber: dto.bankAccountNumber,
      ifscCode: dto.ifscCode,
      bloodGroup: dto.bloodGroup,
      emergencyContactName: dto.emergencyContactName,
      emergencyContactPhone: dto.emergencyContactPhone,
      ctcLpa: dto.ctcLpa,
    };
  }

  // First-run setup only: creates the very first Super Admin account when
  // the company has zero employees (e.g. right after the pilot-launch data
  // reset in SettingsService.applyPilotDataReset wipes every employee,
  // including whoever ran it). Guarded solely by that employee.count() === 0
  // check — there is no other way to get a session at that point, since
  // every other creation path requires an existing authenticated actor.
  // Self-closing: the moment this succeeds once, the count is no longer
  // zero and every subsequent call is rejected.
  async bootstrapFirstSuperAdmin(dto: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }): Promise<SafeEmployee> {
    const existingCount = await this.prisma.employee.count();
    if (existingCount > 0) {
      throw new ForbiddenException(
        'Setup already completed — an employee account already exists.',
      );
    }

    const companyId = await this.getDefaultCompanyId();
    const passwordHash = await hashPassword(dto.password);
    const employee = await this.createEmployeeWithGeneratedCode((employeeCode) => ({
      company: { connect: { id: companyId } },
      employeeCode,
      firstName: dto.firstName,
      lastName: dto.lastName,
      workEmail: normalizeEmail(dto.email),
      passwordHash,
      role: Role.SUPER_ADMIN,
      status: EmployeeStatus.ACTIVE,
    }));

    return this.stripPasswordHash(employee);
  }

  async create(dto: CreateEmployeeDto, actorId: string): Promise<SafeEmployee> {
    const companyId = dto.companyId ?? (await this.getDefaultCompanyId());
    const status = dto.status ?? EmployeeStatus.ACTIVE_PROBATION;

    this.assertMandatoryFieldsForActive(dto, status);
    await this.assertNoCircularManager(null, dto.reportingManagerId);

    const employee = await this.createEmployeeWithGeneratedCode((employeeCode) =>
      this.toCreateData(dto, companyId, employeeCode, status),
    );

    await this.notifications.send({
      recipientId: employee.id,
      template: 'employee.welcome',
      body: `Welcome, ${employee.firstName}! Your employee account has been created.`,
      data: { createdBy: actorId },
    });

    return this.stripPasswordHash(employee);
  }

  // ---------------------------------------------------------------------
  // Auth Phase 2: employee invitation + account activation. Deliberately
  // separate from create() above — that method's mandatory-for-active
  // field set (dob, PAN, bank details, ...) doesn't apply to an
  // invited-but-not-onboarded account, and the input shape (no profile
  // fields) is genuinely different. employeeCode is system-generated by
  // both paths via createEmployeeWithGeneratedCode, never caller-supplied.
  // ---------------------------------------------------------------------

  // actorRole guards dto.role below (this task's single-create-path
  // change): without it, any HR_ADMIN able to call this endpoint could
  // invite a new SUPER_ADMIN. Optional only so existing call sites/tests
  // that never pass a role remain unaffected.
  async inviteEmployee(
    dto: InviteEmployeeDto,
    actorId: string,
    actorRole?: Role,
  ) {
    const normalizedEmail = normalizeEmail(dto.email);
    const existingByEmail = await this.prisma.employee.findFirst({
      where: { workEmail: { equals: normalizedEmail, mode: 'insensitive' } },
    });
    if (existingByEmail) {
      throw new BadRequestException(
        'An employee with this email already exists',
      );
    }

    let role: Role | undefined;
    if (dto.role) {
      const isPrivilegedRoleRequested =
        dto.role === Role.SUPER_ADMIN || dto.role === Role.HR_ADMIN;
      if (isPrivilegedRoleRequested && actorRole !== Role.SUPER_ADMIN) {
        throw new ForbiddenException(
          'Only a Super Admin can assign the HR Admin or Super Admin role',
        );
      }
      role = dto.role;
    }

    await this.assertNoCircularManager(null, dto.reportingManagerId);

    const companyId = await this.getDefaultCompanyId();
    const employee = await this.createEmployeeWithGeneratedCode((employeeCode) => ({
      company: { connect: { id: companyId } },
      employeeCode,
      firstName: dto.firstName,
      lastName: dto.lastName,
      workEmail: normalizedEmail,
      status: EmployeeStatus.INVITED,
      // role: EMPLOYEE (Prisma schema default) unless explicitly
      // requested and permitted above — never accepted unguarded.
      role,
      department: dto.departmentId
        ? { connect: { id: dto.departmentId } }
        : undefined,
      location: dto.locationId ? { connect: { id: dto.locationId } } : undefined,
      reportingManager: dto.reportingManagerId
        ? { connect: { id: dto.reportingManagerId } }
        : undefined,
      designation: dto.designationId
        ? { connect: { id: dto.designationId } }
        : undefined,
      grade: dto.gradeId ? { connect: { id: dto.gradeId } } : undefined,
      employmentType: dto.employmentType,
      ctcLpa: dto.ctcLpa,
    }));

    const { rawToken, expiresAt } = await this.createInvitationToken(
      employee.id,
    );
    const { sent: emailSent, invitationUrl } = await this.sendInvitationEmail(
      employee.firstName,
      dto.email,
      rawToken,
      false,
    );

    await this.notifications.send({
      recipientId: employee.id,
      template: 'employee.invited',
      body: `You've been invited to join. Check your email (${dto.email}) for your activation link.`,
      data: { invitedBy: actorId },
    });

    return {
      employee: this.stripPasswordHash(employee),
      invitation: { expiresAt },
      emailSent,
      // Only returned when delivery failed/isn't configured — the caller
      // (HR Admin/Super Admin) already has legitimate access to this
      // employee's invite, so this is a safe copy-paste fallback rather
      // than a dead end that just says "wait for email".
      invitationUrl: emailSent ? undefined : invitationUrl,
    };
  }

  // Business rule: only an employee still in the INVITED state can be
  // re-invited (an already-active account has nothing to activate).
  // Previous unused invitations are deleted outright so a stale link stops
  // working the instant a new one is issued, rather than merely aging out.
  async resendInvitation(employeeId: string, actorId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.status !== EmployeeStatus.INVITED) {
      throw new BadRequestException(
        'Only invited (not yet activated) employees can be re-invited',
      );
    }
    if (!employee.workEmail) {
      throw new BadRequestException(
        'This employee has no email on file to invite',
      );
    }

    await this.prisma.employeeInvitation.deleteMany({
      where: { employeeId, usedAt: null },
    });

    const { rawToken, expiresAt } =
      await this.createInvitationToken(employeeId);
    const { sent: emailSent, invitationUrl } = await this.sendInvitationEmail(
      employee.firstName,
      employee.workEmail,
      rawToken,
      true,
    );

    await this.notifications.send({
      recipientId: employee.id,
      template: 'employee.invited',
      body: `Your invitation link has been resent. Check your email (${employee.workEmail}) for your activation link.`,
      data: { invitedBy: actorId, resend: true },
    });

    return {
      invitation: { expiresAt },
      emailSent,
      invitationUrl: emailSent ? undefined : invitationUrl,
    };
  }

  // This task: employee dismissal/deactivation. Never a hard delete —
  // Employee is historical HR data (performance rows all reference it by
  // id). Reuses the existing TERMINATED status rather than
  // introducing a new one, and reuses the same "delete unused invitations"
  // step resendInvitation already relies on to invalidate any pending
  // invite, so a terminated employee's old invitation link stops working
  // immediately rather than merely failing the status check in
  // findValidInvitationOrThrow as a fallback.
  async dismissEmployee(id: string, actorId: string): Promise<SafeEmployee> {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.status === EmployeeStatus.TERMINATED) {
      throw new BadRequestException('Employee is already terminated');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id },
        data: { status: EmployeeStatus.TERMINATED },
      }),
      this.prisma.employeeInvitation.deleteMany({
        where: { employeeId: id, usedAt: null },
      }),
    ]);

    await this.notifications.send({
      recipientId: id,
      template: 'employee.terminated',
      body: 'Your employment has been marked as terminated.',
      data: { terminatedBy: actorId },
    });

    return this.stripPasswordHash(updated);
  }

  // This task: Super Admin-only permanent removal, for test/development
  // cleanup only — Dismiss above (TERMINATED) remains the real-world
  // offboarding path and is completely untouched by this method.
  //
  // Three-part strategy (see the constants above for the full per-model
  // classification): (1) employee-owned rows are deleted with the employee,
  // (2) nullable secondary-role references pointing at this employee are
  // cleared to NULL rather than blocking the delete, (3) required
  // references to genuine business records (job requisitions, tickets,
  // announcements, performance records, recognitions, reports, workflow
  // history) are never deleted or force-nulled — if any exist, the whole
  // operation is rejected up front with a specific, actionable error naming
  // every blocking model and row count, before any write happens.
  async deleteEmployee(id: string): Promise<{
    deleted: true;
    employeeCode: string;
  }> {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException('Employee not found');

    const blockers: string[] = [];
    for (const ref of BLOCKING_EMPLOYEE_REFERENCES) {
      const count = await (
        this.prisma[ref.model] as unknown as {
          count: (args: { where: Record<string, string> }) => Promise<number>;
        }
      ).count({ where: { [ref.field]: id } });
      if (count > 0) {
        blockers.push(`a required ${ref.label} by ${count} record${count > 1 ? 's' : ''}`);
      }
    }
    if (blockers.length > 0) {
      throw new BadRequestException(
        `Cannot delete ${employee.firstName} ${employee.lastName}. The employee is referenced as ${blockers.join(', and ')}. Reassign or remove those references before deleting.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Grandchild cleanup: several employee-owned models (deleted below via
      // EMPLOYEE_OWNED_MODELS) have their own child rows that reference THEM
      // — not the employee directly — so they aren't covered by any
      // employeeId-scoped deleteMany and would otherwise block the parent
      // row's deletion with a foreign-key violation one level down. Derived
      // from every model in the schema with a FK to one of the
      // EMPLOYEE_OWNED_MODELS (verified via Prisma.dmmf, not guessed).
      const checklist = await tx.onboardingChecklist.findUnique({
        where: { employeeId: id },
      });
      if (checklist) {
        await tx.checklistTask.deleteMany({ where: { checklistId: checklist.id } });
      }
      const resignation = await tx.resignation.findUnique({
        where: { employeeId: id },
      });
      if (resignation) {
        await tx.clearanceItem.deleteMany({ where: { resignationId: resignation.id } });
        await tx.lwdAdjustment.deleteMany({ where: { resignationId: resignation.id } });
      }
      // AssistantConversation is one-to-many (not unique per employee like
      // the two above), so every matching parent row's id needs collecting
      // before its own children can be cleared.
      const conversations = await tx.assistantConversation.findMany({
        where: { employeeId: id },
        select: { id: true },
      });
      if (conversations.length > 0) {
        await tx.assistantMessage.deleteMany({
          where: { conversationId: { in: conversations.map((c) => c.id) } },
        });
      }

      for (const ref of NULLABLE_EMPLOYEE_REFERENCES) {
        await (
          tx[ref.model] as unknown as {
            updateMany: (args: {
              where: Record<string, string>;
              data: Record<string, null>;
            }) => Promise<unknown>;
          }
        ).updateMany({
          where: { [ref.field]: id },
          data: { [ref.field]: null },
        });
      }
      for (const model of EMPLOYEE_OWNED_MODELS) {
        await (
          tx[model] as unknown as {
            deleteMany: (args: {
              where: { employeeId: string };
            }) => Promise<unknown>;
          }
        ).deleteMany({ where: { employeeId: id } });
      }
      await tx.employee.delete({ where: { id } });
    });

    return { deleted: true, employeeCode: employee.employeeCode };
  }

  listPendingInvitations() {
    return this.prisma.employeeInvitation.findMany({
      where: { usedAt: null },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            workEmail: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Read-only check used by the public activation page to render the
  // employee's name before they submit a password — never returns
  // passwordHash or any field beyond basic identity.
  async validateInvitationToken(rawToken: string) {
    const invitation = await this.findValidInvitationOrThrow(rawToken);
    return {
      firstName: invitation.employee.firstName,
      lastName: invitation.employee.lastName,
      employeeCode: invitation.employee.employeeCode,
      email: invitation.employee.workEmail,
      expiresAt: invitation.expiresAt,
    };
  }

  // Security requirements (Auth Phase 2 #8): role/employeeCode/company/
  // department/manager are never touched here — activation only ever sets
  // passwordHash + status, both derived server-side.
  async activateAccount(dto: ActivateAccountDto): Promise<{ success: true }> {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const invitation = await this.findValidInvitationOrThrow(dto.token);
    const passwordHash = await hashPassword(dto.password);

    await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id: invitation.employeeId },
        data: { passwordHash, status: EmployeeStatus.ACTIVE },
      }),
      this.prisma.employeeInvitation.update({
        where: { id: invitation.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { success: true };
  }

  private async findValidInvitationOrThrow(rawToken: string) {
    const tokenHash = hashInvitationToken(rawToken);
    const invitation = await this.prisma.employeeInvitation.findUnique({
      where: { tokenHash },
      include: { employee: true },
    });
    if (!invitation) {
      throw new NotFoundException('Invalid or expired invitation link');
    }
    if (invitation.employee.status === EmployeeStatus.TERMINATED) {
      throw new BadRequestException('This invitation link is no longer valid');
    }
    if (invitation.usedAt) {
      throw new BadRequestException(
        'This invitation link has already been used',
      );
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation link has expired');
    }
    return invitation;
  }

  private async createInvitationToken(employeeId: string) {
    const rawToken = generateInvitationToken();
    const tokenHash = hashInvitationToken(rawToken);
    const expiresAt = new Date(
      Date.now() + INVITATION_TTL_HOURS * 60 * 60 * 1000,
    );
    await this.prisma.employeeInvitation.create({
      data: { employeeId, tokenHash, expiresAt },
    });
    return { rawToken, expiresAt };
  }

  private async sendInvitationEmail(
    firstName: string,
    email: string,
    rawToken: string,
    isResend: boolean,
  ): Promise<{ sent: boolean; invitationUrl: string }> {
    const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const invitationUrl = `${baseUrl}/activate-account?token=${rawToken}`;
    const result = await this.email.send({
      to: email,
      subject: 'You are invited to Redrob HRMS',
      text: [
        `Hi ${firstName},`,
        '',
        isResend
          ? 'Here is a new invitation link to activate your Redrob HRMS account.'
          : 'You have been invited to activate your Redrob HRMS account.',
        `Activate your account: ${invitationUrl}`,
        `This link expires in ${INVITATION_TTL_HOURS} hours.`,
        '',
        'If you were not expecting this invitation, you can ignore this email.',
      ].join('\n'),
    });
    // Returned to the caller (an HR Admin/Super Admin who already has
    // legitimate access to this employee's invite) so the UI can offer it
    // as a copy-paste fallback whenever email delivery isn't configured or
    // fails — see inviteEmployee()/resendInvitation() below.
    return { sent: result.sent, invitationUrl };
  }

  // ---------------------------------------------------------------------
  // Admin-assisted password reset + MFA reset, plus the interim
  // self-service "Forgot password?" entry point (forgotPassword() below).
  // Real email delivery isn't configured in production yet, so
  // forgotPassword() deliberately never emails or returns a reset link to
  // whoever asks — that would let anyone reset anyone's password just by
  // typing their email. Instead it notifies every HR Admin/Super Admin,
  // who complete the reset via resetPassword() below exactly as they do
  // today. Revisit once real email delivery is live.
  // ---------------------------------------------------------------------

  private async listPrivilegedIds(): Promise<string[]> {
    const admins = await this.prisma.employee.findMany({
      where: { role: { in: [Role.HR_ADMIN, Role.SUPER_ADMIN] } },
      select: { id: true },
    });
    return admins.map((a) => a.id);
  }

  // Always resolves with no return value regardless of whether the email
  // matched anyone — the controller returns the same generic response
  // either way, so this never leaks which emails exist in the system.
  async forgotPassword(email: string): Promise<void> {
    const employee = await this.prisma.employee.findFirst({
      where: { workEmail: { equals: email.trim(), mode: 'insensitive' } },
    });
    if (!employee) return;

    const privilegedIds = await this.listPrivilegedIds();
    await Promise.all(
      privilegedIds.map((id) =>
        this.notifications.send({
          recipientId: id,
          template: 'auth.password-reset-requested',
          body: `${employee.firstName} ${employee.lastName} (${employee.workEmail}) asked for help signing in — use Reset Password on their profile to send them a new link.`,
          data: { employeeId: employee.id },
        }),
      ),
    );
  }

  // Mirrors inviteEmployee's isPrivilegedRoleRequested gate: an HR Admin
  // can reset password/MFA for ordinary staff, but only a Super Admin can
  // do it for another HR Admin or Super Admin — otherwise an HR Admin
  // could take over a Super Admin account by resetting its password and
  // MFA in sequence.
  private async assertCanResetCredentials(
    targetId: string,
    actorRole?: Role,
  ): Promise<Employee> {
    const target = await this.prisma.employee.findUnique({
      where: { id: targetId },
    });
    if (!target) throw new NotFoundException('Employee not found');

    const targetIsPrivileged =
      target.role === Role.SUPER_ADMIN || target.role === Role.HR_ADMIN;
    if (targetIsPrivileged && actorRole !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only a Super Admin can reset credentials for an HR Admin or Super Admin',
      );
    }
    return target;
  }

  async resetPassword(
    targetId: string,
    actorId: string,
    actorRole: Role | undefined,
  ): Promise<{
    expiresAt: Date;
    emailSent: boolean;
    resetUrl?: string;
  }> {
    const target = await this.assertCanResetCredentials(targetId, actorRole);
    if (!target.workEmail) {
      throw new BadRequestException(
        'This employee has no work email on file to reset a password for',
      );
    }

    // Previous unused reset links are invalidated the instant a new one is
    // issued, same reasoning as resendInvitation() below — a stale link
    // left lying around (e.g. in an old chat message) shouldn't stay live
    // once a fresher one exists.
    await this.prisma.passwordResetToken.deleteMany({
      where: { employeeId: targetId, usedAt: null },
    });

    const rawToken = generateInvitationToken();
    const tokenHash = hashInvitationToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000);
    await this.prisma.passwordResetToken.create({
      data: { employeeId: targetId, tokenHash, expiresAt },
    });

    const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;
    const result = await this.email.send({
      to: target.workEmail,
      subject: 'Reset your Redrob HRMS password',
      text: [
        `Hi ${target.firstName},`,
        '',
        'A password reset was requested for your Redrob HRMS account.',
        `Reset your password: ${resetUrl}`,
        `This link expires in ${PASSWORD_RESET_TTL_HOURS} hours.`,
        '',
        'If you did not expect this, contact your HR Admin.',
      ].join('\n'),
    });

    await this.notifications.send({
      recipientId: targetId,
      template: 'auth.password-reset',
      body: 'A password reset was requested for your account by an HR Admin/Super Admin.',
      data: { resetBy: actorId },
    });

    return {
      expiresAt,
      emailSent: result.sent,
      resetUrl: result.sent ? undefined : resetUrl,
    };
  }

  // Direct action, no token/link — clearing mfaSecret/mfaEnabled doesn't by
  // itself grant access to anything (the account's password is untouched),
  // so unlike resetPassword above there's no "prove you're the account
  // owner" step needed: login's own existing logic already re-enrolls MFA
  // from scratch the next time this employee signs in (see
  // auth.controller.ts's login()).
  async resetMfa(targetId: string, actorRole: Role | undefined): Promise<{ success: true }> {
    await this.assertCanResetCredentials(targetId, actorRole);
    await this.prisma.employee.update({
      where: { id: targetId },
      data: { mfaSecret: null, mfaEnabled: false },
    });
    await this.notifications.send({
      recipientId: targetId,
      template: 'auth.mfa-reset',
      body: 'Your MFA was reset by an HR Admin/Super Admin. You will be asked to set it up again next time you sign in.',
    });
    return { success: true };
  }

  // Read-only check used by the public reset-password page to render the
  // employee's name before they submit a new password — mirrors
  // validateInvitationToken above.
  async validatePasswordResetToken(rawToken: string) {
    const reset = await this.findValidPasswordResetOrThrow(rawToken);
    return {
      firstName: reset.employee.firstName,
      lastName: reset.employee.lastName,
      employeeCode: reset.employee.employeeCode,
      expiresAt: reset.expiresAt,
    };
  }

  async consumePasswordReset(
    dto: ConsumePasswordResetDto,
  ): Promise<{ success: true }> {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const reset = await this.findValidPasswordResetOrThrow(dto.token);
    const passwordHash = await hashPassword(dto.password);

    await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id: reset.employeeId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
      // Kills every existing session for this account — a password reset
      // is exactly the moment a stale/compromised session (e.g. on a lost
      // device) should stop working, not keep riding on the old token.
      this.prisma.refreshToken.updateMany({
        where: { employeeId: reset.employeeId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { success: true };
  }

  private async findValidPasswordResetOrThrow(rawToken: string) {
    const tokenHash = hashInvitationToken(rawToken);
    const reset = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { employee: true },
    });
    if (!reset) {
      throw new NotFoundException('Invalid or expired password reset link');
    }
    if (reset.employee.status === EmployeeStatus.TERMINATED) {
      throw new BadRequestException('This password reset link is no longer valid');
    }
    if (reset.usedAt) {
      throw new BadRequestException(
        'This password reset link has already been used',
      );
    }
    if (reset.expiresAt < new Date()) {
      throw new BadRequestException('This password reset link has expired');
    }
    return reset;
  }

  // ---------------------------------------------------------------------
  // Auth Phase 3: employee profile completion. employeeId always comes
  // from the authenticated CurrentUser (see controller) — never from a
  // param or body — so this pair of methods can only ever read/write the
  // caller's own record.
  // ---------------------------------------------------------------------

  async getMyProfile(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    return {
      employee: this.stripPasswordHash(employee),
      ...computeProfileCompletion(employee),
    };
  }

  // Deliberately a DIRECT write, not routed through the change-request/
  // HR-approval path that the generic PATCH /employees/:id self-service
  // update uses (see createChangeRequestsFromDto) — that flow exists for
  // employees CHANGING an already-established master-record value.
  // Profile completion is filling in blank fields that don't have an
  // established value yet, and Auth Phase 3 explicitly requires the save
  // to take effect immediately (Save & Continue / Save & Complete Later),
  // not sit pending HR approval. The dto only ever declares the fields
  // below (see update-my-profile.dto.ts) — role/company/department/
  // designation/reportingManager/status/employeeCode/passwordHash are
  // never accepted here.
  async updateMyProfile(employeeId: string, dto: UpdateMyProfileDto) {
    const updated = await this.prisma.employee.update({
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
        pan: dto.pan,
        aadhaar: dto.aadhaar,
        bankAccountNumber: dto.bankAccountNumber,
        ifscCode: dto.ifscCode,
        bloodGroup: dto.bloodGroup,
        emergencyContactName: dto.emergencyContactName,
        emergencyContactPhone: dto.emergencyContactPhone,
        photoUrl: dto.photoUrl,
      },
    });

    return {
      employee: this.stripPasswordHash(updated),
      ...computeProfileCompletion(updated),
    };
  }

  // employeeId always comes from the JWT via CurrentUser, same as
  // getMyProfile/updateMyProfile above — this can only ever change the
  // caller's own password, never another employee's.
  async changeMyPassword(employeeId: string, dto: ChangePasswordDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const currentPasswordMatches =
      !!employee.passwordHash &&
      (await verifyPassword(dto.currentPassword, employee.passwordHash));
    if (!currentPasswordMatches) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (dto.newPassword !== dto.confirmNewPassword) {
      throw new BadRequestException('New passwords do not match');
    }

    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.employee.update({
      where: { id: employeeId },
      data: { passwordHash },
    });

    return { success: true };
  }

  async getReferenceData() {
    const [departments, designations, grades, locations, managers] =
      await Promise.all([
        this.prisma.department.findMany({ where: { isActive: true } }),
        this.prisma.designation.findMany({ where: { isActive: true } }),
        this.prisma.grade.findMany({ where: { isActive: true } }),
        this.prisma.location.findMany({ where: { isActive: true } }),
        this.prisma.employee.findMany({
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            // Additive fields (existing consumers of this shared "managers"
            // list — ATS, Onboarding, Performance, Assets, Helpdesk,
            // Announcements, Analytics, Shift — all need the FULL roster,
            // not just people eligible to be a reporting manager, so this
            // stays unfiltered here; role/status let the one consumer that
            // needs eligibility (the Reporting Manager picker) filter
            // client-side without a second endpoint or a second fetch.
            role: true,
            status: true,
          },
          orderBy: { firstName: 'asc' },
        }),
      ]);
    return { departments, designations, grades, locations, managers };
  }

  // Section 6 Access Control: unlike getReferenceData(), this never includes
  // the employee roster — departments/designations/locations aren't PII, but
  // the "managers" list is effectively the whole company directory, and an
  // Employee's own dashboard has no legitimate need to see anyone else's
  // name/code just to render its own department/location columns.
  async getOrgLookup() {
    const [departments, designations, locations] = await Promise.all([
      this.prisma.department.findMany({ where: { isActive: true } }),
      this.prisma.designation.findMany({ where: { isActive: true } }),
      this.prisma.location.findMany({ where: { isActive: true } }),
    ]);
    return { departments, designations, locations };
  }

  // Super Admin-only Excel export of the active roster (Employee module).
  // Reuses ACTIVE_STATUSES — the same ACTIVE + ACTIVE_PROBATION definition
  // "active" already means everywhere else in this service.
  async exportActiveEmployees(): Promise<Buffer> {
    const employees = await this.prisma.employee.findMany({
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
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
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
  // the shared directory list is an HR Admin/Super Admin/Manager surface,
  // not something every colleague should be able to browse. Mirrors the
  // same self/privileged split assertReadScope already enforces on
  // findOne/getOrgChart, just applied to the list endpoint too.
  async findAll(query: ListEmployeesQueryDto, requester: RequesterContext) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    if (requester.role === Role.EMPLOYEE && requester.userId) {
      const self = await this.prisma.employee.findUnique({
        where: { id: requester.userId },
      });
      const items = self ? [this.maskSensitiveFields(self, requester)] : [];
      return { items, total: items.length, page: 1, pageSize };
    }

    // A Manager's directory is scoped to their own reporting tree (direct +
    // indirect reports), same rule assertCanAccessEmployeeData enforces for
    // single-record reads elsewhere — otherwise this list endpoint would
    // leak the entire company roster to every manager.
    let scopedIds: string[] | undefined;
    if (requester.role === Role.MANAGER && requester.userId) {
      const teamIds = await getReportingHierarchyIds(
        this.prisma,
        requester.userId,
      );
      scopedIds = [requester.userId, ...teamIds];
    } else if (!isPrivilegedRole(requester.role)) {
      // The unscoped company-wide query below is an HR Admin/Super Admin
      // surface only. Previously anyone who was neither EMPLOYEE nor
      // MANAGER fell through to it by omission — that would silently hand
      // the full directory to any other non-privileged role. Explicit
      // allowlist instead: only a privileged role reaches the unscoped
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
          { firstName: { contains: query.search, mode: 'insensitive' } },
          { lastName: { contains: query.search, mode: 'insensitive' } },
          { employeeCode: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      items: items.map((e) => this.maskSensitiveFields(e, requester)),
      total,
      page,
      pageSize,
    };
  }

  async findOne(
    id: string,
    requester: RequesterContext,
  ): Promise<SafeEmployee> {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException('Employee not found');
    await this.assertReadScope(id, requester);
    return this.maskSensitiveFields(employee, requester);
  }

  // Section 6 Access Control Rule: "a Manager can only fetch records where
  // employee.reporting_manager_id = self, recursively for indirect reports."
  private async assertReadScope(
    targetId: string,
    requester: RequesterContext,
  ): Promise<void> {
    if (isPrivilegedRole(requester.role)) return;
    if (requester.userId === targetId) return;
    if (requester.role === Role.MANAGER && requester.userId) {
      if (await this.isReportOf(targetId, requester.userId)) return;
    }
    throw new ForbiddenException('Not authorized to view this employee record');
  }

  private async isReportOf(
    employeeId: string,
    managerId: string,
  ): Promise<boolean> {
    let currentId: string | null = employeeId;
    const visited = new Set<string>();
    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const emp: { reportingManagerId: string | null } | null =
        await this.prisma.employee.findUnique({
          where: { id: currentId },
          select: { reportingManagerId: true },
        });
      currentId = emp?.reportingManagerId ?? null;
      if (currentId === managerId) return true;
    }
    return false;
  }

  // This task: lets the admin employee-profile view show the same
  // completion percentage/missing-fields breakdown Auth Phase 3 already
  // computes for self-service — reuses computeProfileCompletion() directly
  // rather than recalculating it, scoped by the same read-access rule as
  // findOne/getOrgChart (self, privileged, or the target's manager).
  async getProfileCompletionForEmployee(
    id: string,
    requester: RequesterContext,
  ) {
    await this.assertReadScope(id, requester);
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException('Employee not found');
    return computeProfileCompletion(employee);
  }

  async revealSensitiveFields(id: string, requester: RequesterContext) {
    const isSelf = requester.userId === id;
    if (!isPrivilegedRole(requester.role) && !isSelf) {
      throw new ForbiddenException();
    }
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException('Employee not found');
    return {
      pan: employee.pan,
      aadhaar: employee.aadhaar,
      bankAccountNumber: employee.bankAccountNumber,
    };
  }

  async update(
    id: string,
    dto: UpdateEmployeeDto,
    requester: RequesterContext,
  ) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException('Employee not found');

    const isSelf = requester.userId === id;
    if (!isPrivilegedRole(requester.role)) {
      if (!isSelf) throw new ForbiddenException();
      return this.createChangeRequestsFromDto(id, dto);
    }

    // These 8 fields are Super Admin-only — an HR Admin can edit everything
    // else on this endpoint (CTC, PAN/bank details, contact info, etc.) but
    // not reassign someone's manager/department/designation/grade/location/
    // employment type/joining date/status. No UI ever exposed this to HR
    // Admin either, so this only closes an API-level gap.
    const superAdminOnlyFieldsTouched = SUPER_ADMIN_ONLY_FIELDS.some(
      (field) => dto[field] !== undefined,
    );
    if (superAdminOnlyFieldsTouched && requester.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only a Super Admin can change reporting manager, department, designation, grade, location, employment type, date of joining, or status',
      );
    }

    if (dto.reportingManagerId !== undefined) {
      await this.assertNoCircularManager(id, dto.reportingManagerId);
    }

    // Only re-validate when this update is actually transitioning the
    // employee's status (e.g. INVITED -> ACTIVE) — not on every subsequent
    // edit of someone who's already active. Otherwise a genuinely unrelated
    // change (e.g. just updating their department) would be permanently
    // blocked by an older record's pre-existing gaps (PAN/bank details/
    // emergency contact filled in gradually, not all at once).
    if (dto.status !== undefined && dto.status !== employee.status) {
      this.assertMandatoryFieldsForActive({ ...employee, ...dto }, dto.status);
    }

    const historyData = this.diffForHistory(employee, dto, requester.userId);

    const updated = await this.prisma.employee.update({
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
        dateOfJoining: dto.dateOfJoining
          ? new Date(dto.dateOfJoining)
          : undefined,
        employmentType: dto.employmentType,
        status: dto.status,
        pan: dto.pan,
        aadhaar: dto.aadhaar,
        bankAccountNumber: dto.bankAccountNumber,
        ifscCode: dto.ifscCode,
        bloodGroup: dto.bloodGroup,
        emergencyContactName: dto.emergencyContactName,
        emergencyContactPhone: dto.emergencyContactPhone,
        ctcLpa: dto.ctcLpa,
      },
    });

    if (historyData.length > 0) {
      await this.prisma.employeeHistory.createMany({ data: historyData });
    }

    return this.maskSensitiveFields(updated, requester);
  }

  private diffForHistory(
    employee: Employee,
    dto: UpdateEmployeeDto,
    changedBy?: string,
  ): Prisma.EmployeeHistoryCreateManyInput[] {
    const entries: Prisma.EmployeeHistoryCreateManyInput[] = [];
    const trackedFields = [
      'firstName',
      'lastName',
      'departmentId',
      'designationId',
      'gradeId',
      'locationId',
      'reportingManagerId',
      'employmentType',
      'status',
    ] as const;

    for (const field of trackedFields) {
      const newValue = dto[field];
      if (newValue === undefined) continue;
      const oldValue = employee[field];
      if (String(oldValue ?? '') === String(newValue ?? '')) continue;
      entries.push({
        employeeId: employee.id,
        fieldChanged: field,
        oldValue: oldValue != null ? String(oldValue) : null,
        newValue: newValue != null ? String(newValue) : null,
        changedBy: changedBy ?? 'system',
      });
    }
    return entries;
  }

  private async createChangeRequestsFromDto(
    employeeId: string,
    dto: UpdateEmployeeDto,
  ) {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
    });

    const toCreate: Prisma.ProfileChangeRequestCreateManyInput[] = [];
    for (const field of SELF_SERVICE_FIELDS) {
      const newValue = dto[field];
      if (newValue === undefined) continue;
      const rawOldValue = employee[field];
      // dob is a Date on the record but a plain "YYYY-MM-DD" string on the
      // DTO — normalize to the date-only string before comparing/storing so
      // resubmitting an unchanged dob isn't flagged as a change just
      // because of the type mismatch.
      const oldValue =
        rawOldValue instanceof Date
          ? rawOldValue.toISOString().slice(0, 10)
          : rawOldValue;
      if (String(oldValue ?? '') === String(newValue ?? '')) continue;
      toCreate.push({
        employeeId,
        fieldName: field,
        oldValue: oldValue != null ? String(oldValue) : null,
        newValue: String(newValue),
      });
    }

    if (toCreate.length === 0) {
      return { changeRequestsCreated: 0 };
    }

    await this.prisma.profileChangeRequest.createMany({ data: toCreate });

    await this.notifications.send({
      recipientId: 'hr-admin',
      template: 'profile-change.submitted',
      body: `${employee.firstName} ${employee.lastName} submitted a profile change request for: ${toCreate.map((c) => c.fieldName).join(', ')}.`,
      data: { employeeId, fields: toCreate.map((c) => c.fieldName) },
    });

    return { changeRequestsCreated: toCreate.length };
  }

  async approveChangeRequest(requestId: string, reviewerId: string) {
    const request = await this.prisma.profileChangeRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Change request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('Change request already reviewed');
    }

    await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id: request.employeeId },
        data: {
          // ProfileChangeRequest.newValue is always a plain string — dob is
          // the one self-service field that isn't a String column on
          // Employee, so it needs the same string-to-Date conversion the
          // other write paths (toCreateData/update) already do.
          [request.fieldName]:
            request.fieldName === 'dob'
              ? new Date(request.newValue)
              : request.newValue,
        },
      }),
      this.prisma.employeeHistory.create({
        data: {
          employeeId: request.employeeId,
          fieldChanged: request.fieldName,
          oldValue: request.oldValue,
          newValue: request.newValue,
          changedBy: reviewerId,
        },
      }),
      this.prisma.profileChangeRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
        },
      }),
    ]);

    await this.notifications.send({
      recipientId: request.employeeId,
      template: 'profile-change.approved',
      body: `Your request to update ${request.fieldName} was approved.`,
    });
  }

  async rejectChangeRequest(
    requestId: string,
    reviewerId: string,
    reason?: string,
  ) {
    const request = await this.prisma.profileChangeRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Change request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('Change request already reviewed');
    }

    await this.prisma.profileChangeRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        rejectionReason: reason,
      },
    });

    await this.notifications.send({
      recipientId: request.employeeId,
      template: 'profile-change.rejected',
      body: `Your request to update ${request.fieldName} was rejected.${reason ? ` Comment: "${reason}"` : ''}`,
      data: { reason },
    });
  }

  async listChangeRequests(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    return this.prisma.profileChangeRequest.findMany({
      where: status ? { status } : undefined,
      include: { employee: true },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async getOrgChart(id: string, requester: RequesterContext) {
    await this.assertReadScope(id, requester);
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: { directReports: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const managers: Employee[] = [];
    let currentManagerId = employee.reportingManagerId;
    while (currentManagerId) {
      const manager: Employee | null = await this.prisma.employee.findUnique({
        where: { id: currentManagerId },
      });
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

  // Self-scoped by construction (always the caller's own department), so
  // this needs no @Roles() gate — same posture as getOrgChart above. Uses
  // a deliberately narrow select, not findAll()'s unscoped findMany + mask,
  // since this is reachable by every role including plain EMPLOYEE.
  async getMyDepartmentColleagues(requesterId: string) {
    const requester = await this.prisma.employee.findUnique({
      where: { id: requesterId },
      select: { departmentId: true },
    });
    if (!requester?.departmentId) return [];

    return this.prisma.employee.findMany({
      where: {
        departmentId: requester.departmentId,
        id: { not: requesterId },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        status: true,
        designation: { select: { name: true } },
      },
      orderBy: { firstName: 'asc' },
    });
  }

  private async validateRow(row: CreateEmployeeDto): Promise<string[]> {
    const instance = plainToInstance(CreateEmployeeDto, row);
    const errors = await validate(instance);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  async bulkImport(
    rows: CreateEmployeeDto[],
    dryRun: boolean,
    actorId: string,
  ) {
    const results: Array<{
      row: number;
      success: boolean;
      employeeId?: string;
      errors?: string[];
    }> = [];

    for (const [index, row] of rows.entries()) {
      const errors = await this.validateRow(row);
      if (errors.length > 0) {
        results.push({ row: index, success: false, errors });
        continue;
      }

      try {
        const status = row.status ?? EmployeeStatus.ACTIVE_PROBATION;
        this.assertMandatoryFieldsForActive(row, status);
        if (!dryRun) {
          const created = await this.create(row, actorId);
          results.push({ row: index, success: true, employeeId: created.id });
        } else {
          results.push({ row: index, success: true });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
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
}
