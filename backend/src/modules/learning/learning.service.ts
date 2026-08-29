import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LearningRequestStatus, Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { SubmitLearningRequestDto } from './dto/submit-learning-request.dto';
import { LearningDecisionDto } from './dto/learning-decision.dto';

function isPrivileged(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
}

// CTC-tiered annual reimbursement cap — see the spreadsheet this was
// sourced from ("SE Reimbursement upto on submission of actuals").
function annualLimitFor(ctcLpa: number): number {
  if (ctcLpa < 15) return 30000;
  if (ctcLpa < 25) return 40000;
  if (ctcLpa < 35) return 55000;
  return 70000;
}

@Injectable()
export class LearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // Same "manager, else any HR Admin/Super Admin, else fail explicitly"
  // fallback pattern used by WfoWfhRequestService — no silent no-approver
  // gap.
  private async listPrivilegedIds(excludeId?: string): Promise<string[]> {
    const admins = await this.prisma.employee.findMany({
      where: {
        role: Role.SUPER_ADMIN,
        ...(excludeId && { id: { not: excludeId } }),
      },
      select: { id: true },
    });
    return admins.map((a) => a.id);
  }

  private stripPasswordHash<T extends { employee?: Record<string, unknown> | null }>(
    request: T,
  ) {
    if (!request.employee) return request;
    const safeEmployee = { ...request.employee };
    delete safeEmployee.passwordHash;
    return { ...request, employee: safeEmployee };
  }

  private async computeSpendLimit(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.ctcLpa == null) {
      throw new BadRequestException(
        'Your CTC must be on file before you can request learning reimbursement — contact HR.',
      );
    }

    const requestYear = new Date().getUTCFullYear();
    const annualLimit = annualLimitFor(employee.ctcLpa);
    const requests = await this.prisma.learningRequest.findMany({
      where: {
        employeeId,
        requestYear,
        status: { not: LearningRequestStatus.REJECTED },
      },
      select: { cost: true },
    });
    const used = requests.reduce((sum, r) => sum + r.cost, 0);

    return {
      employeeId,
      ctcLpa: employee.ctcLpa,
      requestYear,
      annualLimit,
      used,
      remaining: annualLimit - used,
    };
  }

  getMySpendLimit(employeeId: string) {
    return this.computeSpendLimit(employeeId);
  }

  // Super Admin only — the complete roster, not just employees who happen
  // to have a CTC on file; a missing CTC surfaces as null fields instead
  // of silently dropping that employee from the table.
  async listAllSpendLimits() {
    const employees = await this.prisma.employee.findMany({
      select: { id: true, firstName: true, lastName: true, employeeCode: true, ctcLpa: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const requestYear = new Date().getUTCFullYear();
    return Promise.all(
      employees.map(async (e) => {
        const base = {
          firstName: e.firstName,
          lastName: e.lastName,
          employeeCode: e.employeeCode,
        };
        if (e.ctcLpa == null) {
          return {
            ...base,
            employeeId: e.id,
            ctcLpa: null,
            requestYear,
            annualLimit: null,
            used: 0,
            remaining: null,
          };
        }
        return { ...base, ...(await this.computeSpendLimit(e.id)) };
      }),
    );
  }

  async submitRequest(
    employeeId: string,
    dto: SubmitLearningRequestDto,
    actorRole?: Role,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const limit = await this.computeSpendLimit(employeeId);
    if (dto.cost > limit.remaining) {
      throw new BadRequestException(
        `This course costs more than your remaining learning budget for the year (₹${limit.remaining} left of ₹${limit.annualLimit}).`,
      );
    }

    const requestYear = limit.requestYear;

    // A Super Admin's own request needs nobody's approval.
    if (actorRole === Role.SUPER_ADMIN) {
      return this.prisma.learningRequest.create({
        data: {
          employeeId,
          ...dto,
          requestYear,
          status: LearningRequestStatus.APPROVED,
          finalApproverId: employeeId,
          decidedAt: new Date(),
        },
      });
    }

    const approverId = employee.reportingManagerId;
    const initialStatus = approverId
      ? LearningRequestStatus.PENDING_MANAGER
      : LearningRequestStatus.PENDING_SUPER_ADMIN;

    const request = await this.prisma.learningRequest.create({
      data: {
        employeeId,
        ...dto,
        requestYear,
        status: initialStatus,
        approverId,
      },
    });

    if (approverId) {
      await this.notifications.send({
        recipientId: approverId,
        template: 'learning.request-submitted',
        body: `${employee.firstName} ${employee.lastName} requested reimbursement for "${dto.courseName}" (₹${dto.cost}) and is awaiting your approval.`,
        data: { requestId: request.id },
      });
      // Super Admin sees this from the moment it's raised (visibility),
      // even though it isn't theirs to act on until the manager has
      // approved it — same two-step semantics as WFO/WFH requests.
      const privilegedIds = (await this.listPrivilegedIds()).filter(
        (id) => id !== approverId,
      );
      await Promise.all(
        privilegedIds.map((id) =>
          this.notifications.send({
            recipientId: id,
            template: 'learning.request-submitted-fyi',
            body: `${employee.firstName} ${employee.lastName} requested reimbursement for "${dto.courseName}" (₹${dto.cost}). It is awaiting manager approval first.`,
            data: { requestId: request.id },
          }),
        ),
      );
    } else {
      // No manager on file — nothing for stage one to do.
      const privilegedIds = await this.listPrivilegedIds();
      await Promise.all(
        privilegedIds.map((id) =>
          this.notifications.send({
            recipientId: id,
            template: 'learning.request-submitted',
            body: `${employee.firstName} ${employee.lastName} requested reimbursement for "${dto.courseName}" (₹${dto.cost}) and has no reporting manager — awaiting your approval.`,
            data: { requestId: request.id },
          }),
        ),
      );
    }

    return request;
  }

  async decide(
    requestId: string,
    actorId: string,
    dto: LearningDecisionDto,
    actorRole?: Role,
  ) {
    const request = await this.prisma.learningRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Learning request not found');

    if (request.status === LearningRequestStatus.PENDING_MANAGER) {
      return this.decideManagerStage(request, actorId, dto, actorRole);
    }
    if (request.status === LearningRequestStatus.PENDING_SUPER_ADMIN) {
      return this.decideFinalStage(request, actorId, dto, actorRole);
    }
    throw new BadRequestException('This request was already decided');
  }

  private async decideManagerStage(
    request: {
      id: string;
      employeeId: string;
      approverId: string | null;
      courseName: string;
      cost: number;
    },
    actorId: string,
    dto: LearningDecisionDto,
    actorRole?: Role,
  ) {
    const isAssignedApprover = request.approverId === actorId;
    if (!isAssignedApprover && !isPrivileged(actorRole)) {
      throw new ForbiddenException(
        'Only the assigned manager or an HR Admin/Super Admin can decide this request',
      );
    }

    if (!dto.approve) {
      await this.prisma.learningRequest.update({
        where: { id: request.id },
        data: {
          status: LearningRequestStatus.REJECTED,
          managerApproverId: actorId,
          managerDecidedAt: new Date(),
          decidedAt: new Date(),
        },
      });
      await this.notifications.send({
        recipientId: request.employeeId,
        template: 'learning.request-rejected',
        body: `Your learning reimbursement request for "${request.courseName}" was rejected.${dto.comment ? ` Comment: "${dto.comment}"` : ''}`,
        data: { comment: dto.comment },
      });
      return { status: LearningRequestStatus.REJECTED };
    }

    await this.prisma.learningRequest.update({
      where: { id: request.id },
      data: {
        status: LearningRequestStatus.PENDING_SUPER_ADMIN,
        managerApproverId: actorId,
        managerDecidedAt: new Date(),
      },
    });

    // Final sign-off audience only — the employee is notified solely at
    // the final outcome, not at this manager-to-final handoff.
    const privilegedIds = await this.listPrivilegedIds();
    await Promise.all(
      privilegedIds.map((id) =>
        this.notifications.send({
          recipientId: id,
          template: 'learning.request-manager-approved',
          body: `The manager approved a ₹${request.cost} learning reimbursement request for "${request.courseName}". It now awaits your final sign-off.`,
          data: { requestId: request.id },
        }),
      ),
    );

    return { status: LearningRequestStatus.PENDING_SUPER_ADMIN };
  }

  private async decideFinalStage(
    request: { id: string; employeeId: string; courseName: string },
    actorId: string,
    dto: LearningDecisionDto,
    actorRole?: Role,
  ) {
    if (actorRole !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only a Super Admin can give final approval on this request',
      );
    }

    await this.prisma.learningRequest.update({
      where: { id: request.id },
      data: dto.approve
        ? {
            status: LearningRequestStatus.APPROVED,
            finalApproverId: actorId,
            decidedAt: new Date(),
          }
        : {
            status: LearningRequestStatus.REJECTED,
            finalApproverId: actorId,
            decidedAt: new Date(),
          },
    });

    await this.notifications.send({
      recipientId: request.employeeId,
      template: dto.approve
        ? 'learning.request-approved'
        : 'learning.request-rejected',
      body: dto.approve
        ? `Your learning reimbursement request for "${request.courseName}" was approved. You can now start the course.`
        : `Your learning reimbursement request for "${request.courseName}" was rejected.${dto.comment ? ` Comment: "${dto.comment}"` : ''}`,
      data: { comment: dto.comment },
    });

    return { status: dto.approve ? LearningRequestStatus.APPROVED : LearningRequestStatus.REJECTED };
  }

  async submitCertificate(
    requestId: string,
    actorId: string,
    certificateRef: string,
  ) {
    const request = await this.prisma.learningRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Learning request not found');
    if (request.employeeId !== actorId) {
      throw new ForbiddenException('This is not your learning request');
    }
    if (request.status !== LearningRequestStatus.APPROVED) {
      throw new BadRequestException(
        'A completion certificate can only be submitted for an approved request',
      );
    }

    const updated = await this.prisma.learningRequest.update({
      where: { id: requestId },
      data: {
        status: LearningRequestStatus.COMPLETED,
        certificateRef,
        completedAt: new Date(),
      },
    });

    const privilegedIds = await this.listPrivilegedIds();
    await Promise.all(
      privilegedIds.map((id) =>
        this.notifications.send({
          recipientId: id,
          template: 'learning.certificate-submitted',
          body: `A completion certificate was submitted for "${request.courseName}" — reimbursement is now pending.`,
          data: { requestId },
        }),
      ),
    );

    return updated;
  }

  async markReimbursed(requestId: string, actorId: string) {
    const request = await this.prisma.learningRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Learning request not found');
    if (request.status !== LearningRequestStatus.COMPLETED) {
      throw new BadRequestException(
        'Only a completed request (certificate submitted) can be marked reimbursed',
      );
    }

    const updated = await this.prisma.learningRequest.update({
      where: { id: requestId },
      data: {
        status: LearningRequestStatus.REIMBURSED,
        reimbursedBy: actorId,
        reimbursedAt: new Date(),
      },
    });

    await this.notifications.send({
      recipientId: request.employeeId,
      template: 'learning.reimbursed',
      body: `Your reimbursement for "${request.courseName}" has been processed.`,
    });

    return updated;
  }

  listMine(employeeId: string) {
    return this.prisma.learningRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPendingForApprover(approverId: string) {
    const requests = await this.prisma.learningRequest.findMany({
      where: { approverId, status: LearningRequestStatus.PENDING_MANAGER },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((r) => this.stripPasswordHash(r));
  }

  async listPendingManagerStageForVisibility() {
    const requests = await this.prisma.learningRequest.findMany({
      where: { status: LearningRequestStatus.PENDING_MANAGER },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((r) => this.stripPasswordHash(r));
  }

  async listPendingFinalApproval() {
    const requests = await this.prisma.learningRequest.findMany({
      where: { status: LearningRequestStatus.PENDING_SUPER_ADMIN },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((r) => this.stripPasswordHash(r));
  }

  async listAll(status?: LearningRequestStatus) {
    const requests = await this.prisma.learningRequest.findMany({
      where: status ? { status } : undefined,
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((r) => this.stripPasswordHash(r));
  }
}
