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
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { RequesterContext, SELF_SERVICE_FIELDS } from './employee.types';

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
  ) {}

  maskSensitiveFields(
    employee: Employee,
    requester: RequesterContext,
  ): Employee {
    const isSelf = requester.userId === employee.id;
    if (isPrivilegedRole(requester.role) || isSelf) {
      return employee;
    }
    const masked = { ...employee };
    for (const field of SENSITIVE_FIELDS) {
      masked[field] = maskValue(employee[field]);
    }
    return masked;
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

  private async generateEmployeeCode(): Promise<string> {
    // employeeCode is globally unique (not scoped per company), so the
    // sequence count must be too — counting per-company here would keep
    // recomputing the same already-taken code for every new company.
    const year = new Date().getFullYear();
    const count = await this.prisma.employee.count({
      where: { employeeCode: { startsWith: `EMP-${year}-` } },
    });
    const seq = (count + 1).toString().padStart(4, '0');
    return `EMP-${year}-${seq}`;
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

  async create(dto: CreateEmployeeDto, actorId: string): Promise<Employee> {
    const companyId = dto.companyId ?? (await this.getDefaultCompanyId());
    const status = dto.status ?? EmployeeStatus.ACTIVE_PROBATION;

    this.assertMandatoryFieldsForActive(dto, status);
    await this.assertNoCircularManager(null, dto.reportingManagerId);

    let employee: Employee | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const employeeCode = await this.generateEmployeeCode();
      try {
        employee = await this.prisma.employee.create({
          data: this.toCreateData(dto, companyId, employeeCode, status),
        });
        break;
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
    if (!employee) {
      throw lastError instanceof Error
        ? lastError
        : new Error('Failed to create employee');
    }

    await this.notifications.send({
      recipientId: employee.id,
      template: 'employee.welcome',
      data: { createdBy: actorId },
    });

    return employee;
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

  async findOne(id: string, requester: RequesterContext): Promise<Employee> {
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
      const oldValue = employee[field];
      if (newValue === oldValue) continue;
      toCreate.push({
        employeeId,
        fieldName: field,
        oldValue: oldValue ?? null,
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
          [request.fieldName]: request.newValue,
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
