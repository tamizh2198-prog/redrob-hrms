import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, RequestCommentType } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CalendarService } from '../../shared/calendar/calendar.service';
import {
  addSuperAdminComment,
  listSuperAdminComments,
} from '../../shared/request-comments/request-comment.util';
import { LeaveService } from './leave.service';
import { CreateCompOffRequestDto } from './dto/create-comp-off-request.dto';
import { LeaveDecisionDto } from './dto/leave-decision.dto';

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

@Injectable()
export class CompOffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly calendar: CalendarService,
    private readonly leaveService: LeaveService,
  ) {}

  // Same "manager, else any HR Admin/Super Admin, else fail explicitly"
  // fallback LeaveService.applyLeave() uses.
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

  async submit(employeeId: string, dto: CreateCompOffRequestDto) {
    const workedDate = startOfDay(new Date(dto.workedDate));
    if (workedDate > startOfDay(new Date())) {
      throw new BadRequestException(
        'Cannot claim comp-off for a future date',
      );
    }

    const nonWorking = await this.calendar.isNonWorkingDay(
      employeeId,
      workedDate,
    );
    if (!nonWorking) {
      throw new BadRequestException(
        'Comp-off can only be claimed for a holiday or week-off day',
      );
    }

    const record = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: workedDate } },
    });
    if (!record?.checkInTime) {
      throw new BadRequestException(
        'No attendance record shows you worked on this date',
      );
    }

    const duplicate = await this.prisma.compOffRequest.findFirst({
      where: {
        employeeId,
        workedDate,
        status: { in: ['PENDING', 'APPROVED'] },
      },
    });
    if (duplicate) {
      throw new BadRequestException(
        'A comp-off request for this date already exists',
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    let approverId = employee.reportingManagerId;
    if (!approverId) {
      approverId = await this.findHrAdminId(employeeId);
      if (!approverId) {
        throw new BadRequestException(
          'No approver is configured for this employee — assign a reporting manager or an HR Admin first',
        );
      }
    }

    const request = await this.prisma.compOffRequest.create({
      data: { employeeId, workedDate, reason: dto.reason, approverId },
    });

    await this.notifications.send({
      recipientId: approverId,
      template: 'comp-off.submitted',
      body: `${employee.firstName} ${employee.lastName} requested comp-off for working on ${workedDate.toISOString().slice(0, 10)}.`,
      data: { requestId: request.id },
    });

    return request;
  }

  async decide(
    requestId: string,
    actorId: string,
    dto: LeaveDecisionDto,
    actorRole?: Role,
  ) {
    const request = await this.prisma.compOffRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Comp-off request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('This request was already decided');
    }

    const isAssignedApprover = request.approverId === actorId;
    if (!isAssignedApprover && !isPrivileged(actorRole)) {
      throw new ForbiddenException(
        'Only the assigned approver or an HR Admin/Super Admin can decide this request',
      );
    }

    if (dto.approve) {
      await this.leaveService.creditCompOffDay(request.employeeId);
      await this.prisma.compOffRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', decidedAt: new Date() },
      });
    } else {
      await this.prisma.compOffRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED', decidedAt: new Date() },
      });
    }

    await this.notifications.send({
      recipientId: request.employeeId,
      template: dto.approve ? 'comp-off.approved' : 'comp-off.rejected',
      body: `Your comp-off request for working on ${request.workedDate.toISOString().slice(0, 10)} was ${dto.approve ? 'approved' : 'rejected'}.${dto.comment ? ` Comment: "${dto.comment}"` : ''}`,
      data: { comment: dto.comment },
    });

    return { status: dto.approve ? 'APPROVED' : 'REJECTED' };
  }

  listMine(employeeId: string) {
    return this.prisma.compOffRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPendingForApprover(approverId: string) {
    const requests = await this.prisma.compOffRequest.findMany({
      where: { approverId, status: 'PENDING' },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((r) => this.stripPasswordHash(r));
  }

  async listAll(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    const requests = await this.prisma.compOffRequest.findMany({
      where: { status },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((r) => this.stripPasswordHash(r));
  }

  async addComment(requestId: string, authorId: string, body: string) {
    const request = await this.prisma.compOffRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Comp-off request not found');

    const comment = await addSuperAdminComment(this.prisma, {
      requestType: RequestCommentType.COMP_OFF,
      requestId,
      authorId,
      body,
    });

    if (request.approverId) {
      await this.notifications.send({
        recipientId: request.approverId,
        template: 'comp-off.comment-added',
        body: `A new comment was added to the comp-off request for ${request.workedDate.toISOString().slice(0, 10)}: "${body}"`,
        data: { requestId },
      });
    }

    return comment;
  }

  async listComments(requestId: string, actorId: string, actorRole?: Role) {
    const request = await this.prisma.compOffRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Comp-off request not found');
    if (request.approverId !== actorId && !isPrivileged(actorRole)) {
      throw new ForbiddenException(
        'Only the assigned approver or an HR Admin/Super Admin can view these comments',
      );
    }
    return listSuperAdminComments(
      this.prisma,
      RequestCommentType.COMP_OFF,
      requestId,
    );
  }
}
