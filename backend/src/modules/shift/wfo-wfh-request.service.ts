import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, RequestCommentType, WorkMode } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import {
  addSuperAdminComment,
  listSuperAdminComments,
} from '../../shared/request-comments/request-comment.util';
import { CreateWfoWfhRequestDto } from './dto/create-wfo-wfh-request.dto';
import { WfoWfhDecisionDto } from './dto/wfo-wfh-decision.dto';

// Normalizes to UTC midnight, not local midnight — see calendar.service.ts
// for why: date-only ISO strings parse as UTC, so a local boundary here
// would shift every stored date key by a day outside UTC+0 servers.
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Decision authority (decideManagerStage/decideFinalStage) — HR_ASSOCIATE
// deliberately excluded, unlike isHrStaff below.
function isPrivileged(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
}

// General visibility (listComments) — mirrors HR_ADMIN's access without
// granting decision authority.
function isHrStaff(role?: Role): boolean {
  return isPrivileged(role) || role === Role.HR_ASSOCIATE;
}

function oppositeWorkMode(mode: WorkMode): WorkMode {
  return mode === WorkMode.OFFICE ? WorkMode.WORK_FROM_HOME : WorkMode.OFFICE;
}

@Injectable()
export class WfoWfhRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // Same "manager, else any HR Admin/Super Admin, else fail explicitly"
  // fallback pattern used elsewhere in this codebase — no silent
  // no-approver gap (nobody notified, approverId left null when the
  // employee has no manager).
  private async findHrAdminId(excludeId?: string): Promise<string | null> {
    const hrAdmin = await this.prisma.employee.findFirst({
      where: {
        role: { in: [Role.HR_ADMIN, Role.SUPER_ADMIN] },
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
    return hrAdmin?.id ?? null;
  }

  private async listPrivilegedIds(excludeId?: string): Promise<string[]> {
    const admins = await this.prisma.employee.findMany({
      where: {
        role: { in: [Role.HR_ADMIN, Role.SUPER_ADMIN] },
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

  private rosterSwapOps(request: {
    employeeId: string;
    originalDate: Date;
    requestedWorkMode: WorkMode;
    compensatoryDate: Date;
    compensatoryWorkMode: WorkMode;
  }) {
    return [
      this.prisma.rosterEntry.upsert({
        where: {
          employeeId_date: {
            employeeId: request.employeeId,
            date: request.originalDate,
          },
        },
        update: { workMode: request.requestedWorkMode },
        create: {
          employeeId: request.employeeId,
          date: request.originalDate,
          workMode: request.requestedWorkMode,
        },
      }),
      this.prisma.rosterEntry.upsert({
        where: {
          employeeId_date: {
            employeeId: request.employeeId,
            date: request.compensatoryDate,
          },
        },
        update: { workMode: request.compensatoryWorkMode, isWeekOff: false },
        create: {
          employeeId: request.employeeId,
          date: request.compensatoryDate,
          workMode: request.compensatoryWorkMode,
          isWeekOff: false,
        },
      }),
    ];
  }

  async submit(
    employeeId: string,
    dto: CreateWfoWfhRequestDto,
    actorRole?: Role,
  ) {
    const originalDate = startOfDay(new Date(dto.originalDate));
    const compensatoryDate = startOfDay(new Date(dto.compensatoryDate));
    if (originalDate.getTime() === compensatoryDate.getTime()) {
      throw new BadRequestException(
        'originalDate and compensatoryDate must be different',
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const existingEntry = await this.prisma.rosterEntry.findUnique({
      where: { employeeId_date: { employeeId, date: originalDate } },
    });
    const currentMode = existingEntry?.workMode ?? WorkMode.OFFICE;
    if (dto.requestedWorkMode === currentMode) {
      throw new BadRequestException(
        'Requested work mode matches the current roster for this date',
      );
    }
    const compensatoryWorkMode = oppositeWorkMode(dto.requestedWorkMode);

    // A Super Admin's own request needs nobody's approval — apply it
    // immediately rather than routing it through a workflow they'd just
    // have to approve themselves.
    if (actorRole === Role.SUPER_ADMIN) {
      const [request] = await this.prisma.$transaction([
        this.prisma.wfoWfhChangeRequest.create({
          data: {
            employeeId,
            originalDate,
            requestedWorkMode: dto.requestedWorkMode,
            compensatoryDate,
            compensatoryWorkMode,
            reason: dto.reason,
            status: 'APPROVED',
            finalApproverId: employeeId,
            decidedAt: new Date(),
          },
        }),
        ...this.rosterSwapOps({
          employeeId,
          originalDate,
          requestedWorkMode: dto.requestedWorkMode,
          compensatoryDate,
          compensatoryWorkMode,
        }),
      ]);
      return request;
    }

    let approverId = employee.reportingManagerId;
    if (!approverId) {
      approverId = await this.findHrAdminId(employeeId);
      if (!approverId) {
        throw new BadRequestException(
          'No approver is configured for this employee — assign a reporting manager or an HR Admin first',
        );
      }
    }

    const request = await this.prisma.wfoWfhChangeRequest.create({
      data: {
        employeeId,
        originalDate,
        requestedWorkMode: dto.requestedWorkMode,
        compensatoryDate,
        compensatoryWorkMode,
        reason: dto.reason,
        approverId,
      },
    });

    const dateLabel = originalDate.toISOString().slice(0, 10);

    await this.notifications.send({
      recipientId: approverId,
      template: 'wfo-wfh-request.submitted',
      body: `${employee.firstName} ${employee.lastName} requested to switch to ${dto.requestedWorkMode} on ${dateLabel} and is awaiting your approval.`,
      data: { requestId: request.id },
    });

    // Super Admin and HR Admin see the request from the moment it's raised
    // (visibility), even though it isn't theirs to act on until the manager
    // has approved it (actionability) — this is the "two step approval,
    // triggers to manager AND super admin AND HR admin" requirement.
    const privilegedIds = (await this.listPrivilegedIds()).filter(
      (id) => id !== approverId,
    );
    await Promise.all(
      privilegedIds.map((id) =>
        this.notifications.send({
          recipientId: id,
          template: 'wfo-wfh-request.submitted-fyi',
          body: `${employee.firstName} ${employee.lastName} requested to switch to ${dto.requestedWorkMode} on ${dateLabel}. It is awaiting manager approval first — you'll be able to act on it once that happens.`,
          data: { requestId: request.id },
        }),
      ),
    );

    return request;
  }

  async decide(
    requestId: string,
    actorId: string,
    dto: WfoWfhDecisionDto,
    actorRole?: Role,
  ) {
    const request = await this.prisma.wfoWfhChangeRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('WFO/WFH request not found');

    if (request.status === 'PENDING_MANAGER') {
      return this.decideManagerStage(request, actorId, dto, actorRole);
    }
    if (request.status === 'PENDING_FINAL_APPROVAL') {
      return this.decideFinalStage(request, actorId, dto, actorRole);
    }
    throw new BadRequestException('This request was already decided');
  }

  private async decideManagerStage(
    request: {
      id: string;
      employeeId: string;
      approverId: string | null;
      requestedWorkMode: WorkMode;
      originalDate: Date;
    },
    actorId: string,
    dto: WfoWfhDecisionDto,
    actorRole?: Role,
  ) {
    const isAssignedApprover = request.approverId === actorId;
    if (!isAssignedApprover && !isPrivileged(actorRole)) {
      throw new ForbiddenException(
        'Only the assigned manager or an HR Admin/Super Admin can decide this request',
      );
    }

    if (!dto.approve) {
      await this.prisma.wfoWfhChangeRequest.update({
        where: { id: request.id },
        data: { status: 'REJECTED', managerApproverId: actorId, managerDecidedAt: new Date(), decidedAt: new Date() },
      });
      await this.notifications.send({
        recipientId: request.employeeId,
        template: 'wfo-wfh-request.rejected',
        body: `Your request to switch to ${request.requestedWorkMode} on ${request.originalDate.toISOString().slice(0, 10)} was rejected.${dto.comment ? ` Comment: "${dto.comment}"` : ''}`,
        data: { comment: dto.comment },
      });
      return { status: 'REJECTED' };
    }

    await this.prisma.wfoWfhChangeRequest.update({
      where: { id: request.id },
      data: {
        status: 'PENDING_FINAL_APPROVAL',
        managerApproverId: actorId,
        managerDecidedAt: new Date(),
      },
    });

    // Final sign-off audience only — the requesting employee is notified
    // solely at the final outcome, not at this manager-to-final handoff.
    const privilegedIds = await this.listPrivilegedIds();
    const dateLabel = request.originalDate.toISOString().slice(0, 10);
    await Promise.all(
      privilegedIds.map((id) =>
        this.notifications.send({
          recipientId: id,
          template: 'wfo-wfh-request.manager-approved',
          body: `The manager approved switching to ${request.requestedWorkMode} on ${dateLabel} for this employee. It now awaits your final sign-off (Super Admin or HR Admin).`,
          data: { requestId: request.id },
        }),
      ),
    );

    return { status: 'PENDING_FINAL_APPROVAL' };
  }

  private async decideFinalStage(
    request: {
      id: string;
      employeeId: string;
      requestedWorkMode: WorkMode;
      originalDate: Date;
      compensatoryDate: Date;
      compensatoryWorkMode: WorkMode;
    },
    actorId: string,
    dto: WfoWfhDecisionDto,
    actorRole?: Role,
  ) {
    if (!isPrivileged(actorRole)) {
      throw new ForbiddenException(
        'Only a Super Admin or HR Admin can give final approval on this request',
      );
    }

    if (dto.approve) {
      await this.prisma.$transaction([
        ...this.rosterSwapOps(request),
        this.prisma.wfoWfhChangeRequest.update({
          where: { id: request.id },
          data: { status: 'APPROVED', finalApproverId: actorId, decidedAt: new Date() },
        }),
      ]);
    } else {
      await this.prisma.wfoWfhChangeRequest.update({
        where: { id: request.id },
        data: { status: 'REJECTED', finalApproverId: actorId, decidedAt: new Date() },
      });
    }

    await this.notifications.send({
      recipientId: request.employeeId,
      template: dto.approve
        ? 'wfo-wfh-request.approved'
        : 'wfo-wfh-request.rejected',
      body: `Your request to switch to ${request.requestedWorkMode} on ${request.originalDate.toISOString().slice(0, 10)} was ${dto.approve ? 'approved' : 'rejected'}.${dto.comment ? ` Comment: "${dto.comment}"` : ''}`,
      data: { comment: dto.comment },
    });

    return { status: dto.approve ? 'APPROVED' : 'REJECTED' };
  }

  listMine(employeeId: string) {
    return this.prisma.wfoWfhChangeRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPendingForApprover(approverId: string) {
    const requests = await this.prisma.wfoWfhChangeRequest.findMany({
      where: { approverId, status: 'PENDING_MANAGER' },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((r) => this.stripPasswordHash(r));
  }

  // Manager-stage requests aren't actionable by Super Admin/HR Admin yet,
  // but they were promised visibility into them at submission time.
  async listPendingManagerStageForVisibility() {
    const requests = await this.prisma.wfoWfhChangeRequest.findMany({
      where: { status: 'PENDING_MANAGER' },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((r) => this.stripPasswordHash(r));
  }

  async listPendingFinalApproval() {
    const requests = await this.prisma.wfoWfhChangeRequest.findMany({
      where: { status: 'PENDING_FINAL_APPROVAL' },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((r) => this.stripPasswordHash(r));
  }

  async listAll(status?: 'PENDING_MANAGER' | 'PENDING_FINAL_APPROVAL' | 'APPROVED' | 'REJECTED') {
    const requests = await this.prisma.wfoWfhChangeRequest.findMany({
      where: { status },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((r) => this.stripPasswordHash(r));
  }

  async addComment(requestId: string, authorId: string, body: string) {
    const request = await this.prisma.wfoWfhChangeRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('WFO/WFH request not found');

    const comment = await addSuperAdminComment(this.prisma, {
      requestType: RequestCommentType.WFO_WFH_CHANGE,
      requestId,
      authorId,
      body,
    });

    if (request.approverId) {
      await this.notifications.send({
        recipientId: request.approverId,
        template: 'wfo-wfh-request.comment-added',
        body: `A new comment was added to the WFO/WFH change request for ${request.originalDate.toISOString().slice(0, 10)}: "${body}"`,
        data: { requestId },
      });
    }

    return comment;
  }

  async listComments(requestId: string, actorId: string, actorRole?: Role) {
    const request = await this.prisma.wfoWfhChangeRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('WFO/WFH request not found');
    if (request.approverId !== actorId && !isHrStaff(actorRole)) {
      throw new ForbiddenException(
        'Only the assigned approver or an HR Admin/Super Admin can view these comments',
      );
    }
    return listSuperAdminComments(
      this.prisma,
      RequestCommentType.WFO_WFH_CHANGE,
      requestId,
    );
  }
}
