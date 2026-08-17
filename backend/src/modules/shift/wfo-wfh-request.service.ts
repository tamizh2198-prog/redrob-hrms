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

function isPrivileged(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
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
  // fallback LeaveService.applyLeave() uses — Regularization's silent
  // no-approver gap (nobody notified, approverId left null when the
  // employee has no manager) isn't repeated here.
  private async findHrAdminId(excludeId?: string): Promise<string | null> {
    const hrAdmin = await this.prisma.employee.findFirst({
      where: {
        role: { in: [Role.HR_ADMIN, Role.SUPER_ADMIN] },
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
    return hrAdmin?.id ?? null;
  }

  private stripPasswordHash<T extends { employee?: Record<string, unknown> | null }>(
    request: T,
  ) {
    if (!request.employee) return request;
    const safeEmployee = { ...request.employee };
    delete safeEmployee.passwordHash;
    return { ...request, employee: safeEmployee };
  }

  async submit(employeeId: string, dto: CreateWfoWfhRequestDto) {
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

    await this.notifications.send({
      recipientId: approverId,
      template: 'wfo-wfh-request.submitted',
      body: `${employee.firstName} ${employee.lastName} requested to switch to ${dto.requestedWorkMode} on ${originalDate.toISOString().slice(0, 10)} and is awaiting your approval.`,
      data: { requestId: request.id },
    });

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
    if (request.status !== 'PENDING') {
      throw new BadRequestException('This request was already decided');
    }

    const isAssignedApprover = request.approverId === actorId;
    if (!isAssignedApprover && !isPrivileged(actorRole)) {
      throw new ForbiddenException(
        'Only the assigned approver or an HR Admin/Super Admin can decide this request',
      );
    }

    if (actorRole !== Role.SUPER_ADMIN) {
      const [originalRecord, compensatoryRecord] = await Promise.all([
        this.prisma.attendanceRecord.findUnique({
          where: {
            employeeId_date: {
              employeeId: request.employeeId,
              date: request.originalDate,
            },
          },
        }),
        this.prisma.attendanceRecord.findUnique({
          where: {
            employeeId_date: {
              employeeId: request.employeeId,
              date: request.compensatoryDate,
            },
          },
        }),
      ]);
      if (originalRecord?.isLocked || compensatoryRecord?.isLocked) {
        throw new ForbiddenException(
          'Roster changes after the attendance lock date require Super Admin override',
        );
      }
    }

    if (dto.approve) {
      await this.prisma.$transaction([
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
        this.prisma.wfoWfhChangeRequest.update({
          where: { id: requestId },
          data: { status: 'APPROVED', decidedAt: new Date() },
        }),
      ]);
    } else {
      await this.prisma.wfoWfhChangeRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED', decidedAt: new Date() },
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
      where: { approverId, status: 'PENDING' },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((r) => this.stripPasswordHash(r));
  }

  async listAll(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
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
    if (request.approverId !== actorId && !isPrivileged(actorRole)) {
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
