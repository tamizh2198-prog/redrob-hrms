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
import { hashPassword } from '../../shared/auth/password.util';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { InviteEmployeeDto } from './dto/invite-employee.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import type { ActivateAccountDto } from '../../shared/auth/dto/activate-account.dto';
import { RequesterContext, SELF_SERVICE_FIELDS } from './employee.types';
import {
  generateInvitationToken,
  hashInvitationToken,
} from './invitation-token.util';
import { computeProfileCompletion } from './profile-completion.util';

const INVITATION_TTL_HOURS = 72;

type SafeEmployee = Omit<Employee, 'passwordHash'>;

const ACTIVE_STATUSES: EmployeeStatus[] = [
  EmployeeStatus.ACTIVE,
  EmployeeStatus.ACTIVE_PROBATION,
];

const SENSITIVE_FIELDS = ['pan', 'aadhaar', 'bankAccountNumber'] as const;

function maskValue(value: string | null): string | null {
  if (!value) return value;
  const visible = value.slice(-4);
  return `****${visible}`;
}

function isPrivilegedRole(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
}

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
    // sequence count must be too — counting per-company here would keep
    // recomputing the same already-taken code for every new company.
    const year = new Date().getFullYear();
    const prefix = `${EmployeeService.EMPLOYEE_CODE_PREFIX}-${year}-`;
    const count = await this.prisma.employee.count({
      where: { employeeCode: { startsWith: prefix } },
    });
    const seq = (count + 1).toString().padStart(4, '0');
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
      workEmail: dto.workEmail,
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
    };
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
    const existingByEmail = await this.prisma.employee.findUnique({
      where: { workEmail: dto.email },
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
      workEmail: dto.email,
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
    }));

    const { rawToken, expiresAt } = await this.createInvitationToken(
      employee.id,
    );
    const emailSent = await this.sendInvitationEmail(
      employee.firstName,
      dto.email,
      rawToken,
      false,
    );

    await this.notifications.send({
      recipientId: employee.id,
      template: 'employee.invited',
      data: { invitedBy: actorId },
    });

    return {
      employee: this.stripPasswordHash(employee),
      invitation: { expiresAt },
      emailSent,
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
    const emailSent = await this.sendInvitationEmail(
      employee.firstName,
      employee.workEmail,
      rawToken,
      true,
    );

    await this.notifications.send({
      recipientId: employee.id,
      template: 'employee.invited',
      data: { invitedBy: actorId, resend: true },
    });

    return { invitation: { expiresAt }, emailSent };
  }

  // This task: employee dismissal/deactivation. Never a hard delete —
  // Employee is historical HR data (attendance/leave/performance rows all
  // reference it by id). Reuses the existing TERMINATED status rather than
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
      data: { terminatedBy: actorId },
    });

    return this.stripPasswordHash(updated);
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
  ): Promise<boolean> {
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
    return result.sent;
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
      },
    });

    return {
      employee: this.stripPasswordHash(updated),
      ...computeProfileCompletion(updated),
    };
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

    const where: Prisma.EmployeeWhereInput = {
      ...(query.departmentId && { departmentId: query.departmentId }),
      ...(query.locationId && { locationId: query.locationId }),
      ...(query.status && { status: query.status }),
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

    if (dto.reportingManagerId !== undefined) {
      await this.assertNoCircularManager(id, dto.reportingManagerId);
    }

    const nextStatus = dto.status ?? employee.status;
    this.assertMandatoryFieldsForActive({ ...employee, ...dto }, nextStatus);

    const historyData = this.diffForHistory(employee, dto, requester.userId);

    const updated = await this.prisma.employee.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        dob: dto.dob ? new Date(dto.dob) : undefined,
        gender: dto.gender,
        personalEmail: dto.personalEmail,
        workEmail: dto.workEmail,
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
