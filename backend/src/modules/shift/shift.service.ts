import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { AssignRosterDto } from './dto/assign-roster.dto';
import { RequestShiftSwapDto } from './dto/request-shift-swap.dto';

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
export class ShiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaultCompany: DefaultCompanyService,
    private readonly notifications: NotificationService,
  ) {}

  async createShift(dto: CreateShiftDto) {
    const companyId =
      dto.companyId ?? (await this.defaultCompany.getOrCreate());
    return this.prisma.shift.create({
      data: {
        companyId,
        name: dto.name,
        startTime: dto.startTime,
        endTime: dto.endTime,
        graceMinutes: dto.graceMinutes ?? 0,
        halfDayHours: dto.halfDayHours ?? 4.5,
        isNightShift: dto.isNightShift ?? false,
      },
    });
  }

  listShifts() {
    return this.prisma.shift.findMany({ orderBy: { name: 'asc' } });
  }

  async assignRoster(dto: AssignRosterDto, actorRole?: Role) {
    if (dto.shiftId) {
      const shift = await this.prisma.shift.findUnique({
        where: { id: dto.shiftId },
      });
      if (!shift) throw new NotFoundException('Shift not found');
    }

    const results: Array<{
      employeeId: string;
      date: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const employeeId of dto.employeeIds) {
      for (const dateStr of dto.dates) {
        const date = startOfDay(new Date(dateStr));
        try {
          const existing = await this.prisma.attendanceRecord.findUnique({
            where: { employeeId_date: { employeeId, date } },
          });
          if (existing?.isLocked && actorRole !== Role.SUPER_ADMIN) {
            throw new ForbiddenException(
              'Roster changes after the attendance lock date require Super Admin override',
            );
          }

          await this.prisma.rosterEntry.upsert({
            where: { employeeId_date: { employeeId, date } },
            update: { shiftId: dto.shiftId, isWeekOff: dto.isWeekOff ?? false },
            create: {
              employeeId,
              date,
              shiftId: dto.shiftId,
              isWeekOff: dto.isWeekOff ?? false,
            },
          });
          results.push({ employeeId, date: dateStr, success: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          results.push({
            employeeId,
            date: dateStr,
            success: false,
            error: message,
          });
        }
      }
    }

    const succeededEmployeeIds = [
      ...new Set(results.filter((r) => r.success).map((r) => r.employeeId)),
    ];
    await Promise.all(
      succeededEmployeeIds.map((employeeId) =>
        this.notifications.send({
          recipientId: employeeId,
          template: 'roster.published',
        }),
      ),
    );

    return {
      totalAssignments: results.length,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
      results,
    };
  }

  async getRoster(employeeId: string, from: Date, to: Date) {
    return this.prisma.rosterEntry.findMany({
      where: {
        employeeId,
        date: { gte: startOfDay(from), lte: startOfDay(to) },
      },
      include: { shift: true },
      orderBy: { date: 'asc' },
    });
  }

  async listSwaps(filter: { employeeId?: string; approverId?: string }) {
    return this.prisma.shiftSwapRequest.findMany({
      where: {
        OR: filter.employeeId
          ? [
              { requesterId: filter.employeeId },
              { counterpartId: filter.employeeId },
            ]
          : undefined,
        approverId: filter.approverId,
      },
      include: { requester: true, counterpart: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async requestSwap(
    requesterId: string,
    dto: RequestShiftSwapDto,
    actorRole?: Role,
  ) {
    const [requester, counterpart] = await Promise.all([
      this.prisma.employee.findUnique({ where: { id: requesterId } }),
      this.prisma.employee.findUnique({ where: { id: dto.counterpartId } }),
    ]);
    if (!requester || !counterpart) {
      throw new NotFoundException('Employee not found');
    }

    const sameDept = requester.departmentId === counterpart.departmentId;
    const overrideAllowed = dto.override && isPrivileged(actorRole);
    if (!sameDept && !overrideAllowed) {
      throw new BadRequestException(
        'Shift swaps must be between employees of the same department unless HR Admin overrides',
      );
    }

    const swap = await this.prisma.shiftSwapRequest.create({
      data: {
        requesterId,
        counterpartId: dto.counterpartId,
        date: startOfDay(new Date(dto.date)),
        approverId: requester.reportingManagerId,
      },
    });

    await Promise.all(
      [requesterId, dto.counterpartId, requester.reportingManagerId]
        .filter((id): id is string => !!id)
        .map((id) =>
          this.notifications.send({
            recipientId: id,
            template: 'shift-swap.requested',
            data: { swapId: swap.id },
          }),
        ),
    );

    return swap;
  }

  async decideSwap(
    swapId: string,
    approverId: string,
    approve: boolean,
    actorRole?: Role,
  ) {
    const swap = await this.prisma.shiftSwapRequest.findUnique({
      where: { id: swapId },
    });
    if (!swap) throw new NotFoundException('Shift swap request not found');
    if (swap.status !== 'PENDING') {
      throw new BadRequestException('This swap request was already decided');
    }
    if (swap.approverId !== approverId && !isPrivileged(actorRole)) {
      throw new ForbiddenException(
        'Not authorized to decide this swap request',
      );
    }

    if (approve) {
      const [requesterEntry, counterpartEntry] = await Promise.all([
        this.prisma.rosterEntry.findUnique({
          where: {
            employeeId_date: { employeeId: swap.requesterId, date: swap.date },
          },
        }),
        this.prisma.rosterEntry.findUnique({
          where: {
            employeeId_date: {
              employeeId: swap.counterpartId,
              date: swap.date,
            },
          },
        }),
      ]);

      await this.prisma.$transaction([
        this.prisma.rosterEntry.upsert({
          where: {
            employeeId_date: { employeeId: swap.requesterId, date: swap.date },
          },
          update: { shiftId: counterpartEntry?.shiftId ?? null },
          create: {
            employeeId: swap.requesterId,
            date: swap.date,
            shiftId: counterpartEntry?.shiftId,
          },
        }),
        this.prisma.rosterEntry.upsert({
          where: {
            employeeId_date: {
              employeeId: swap.counterpartId,
              date: swap.date,
            },
          },
          update: { shiftId: requesterEntry?.shiftId ?? null },
          create: {
            employeeId: swap.counterpartId,
            date: swap.date,
            shiftId: requesterEntry?.shiftId,
          },
        }),
        this.prisma.shiftSwapRequest.update({
          where: { id: swapId },
          data: { status: 'APPROVED', decidedAt: new Date() },
        }),
      ]);
    } else {
      await this.prisma.shiftSwapRequest.update({
        where: { id: swapId },
        data: { status: 'REJECTED', decidedAt: new Date() },
      });
    }

    await Promise.all(
      [swap.requesterId, swap.counterpartId, swap.approverId]
        .filter((id): id is string => !!id)
        .map((id) =>
          this.notifications.send({
            recipientId: id,
            template: approve ? 'shift-swap.approved' : 'shift-swap.rejected',
            data: { swapId },
          }),
        ),
    );

    return { status: approve ? 'APPROVED' : 'REJECTED' };
  }
}
