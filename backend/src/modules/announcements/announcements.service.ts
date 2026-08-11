import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AnnouncementScope, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { CreateRecognitionDto } from './dto/create-recognition.dto';

// Section 7.12 Business Rule: "Mandatory unread reminder → T+2 days."
const REMINDER_DELAY_DAYS = 2;

function isPrivileged(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // Section 7.12 Key Feature: "Target employees by organization,
  // department, or location." Resolves the actual employee set a scope
  // maps to, at creation time — not re-evaluated later, so someone who
  // transfers department after the fact doesn't retroactively gain/lose it.
  private resolveTargets(
    companyId: string,
    scope: AnnouncementScope,
    departmentId?: string,
    locationId?: string,
  ) {
    const where: Prisma.EmployeeWhereInput = { companyId };
    if (scope === AnnouncementScope.DEPARTMENT)
      where.departmentId = departmentId;
    if (scope === AnnouncementScope.LOCATION) where.locationId = locationId;
    return this.prisma.employee.findMany({ where, select: { id: true } });
  }

  async createAnnouncement(dto: CreateAnnouncementDto, actorId: string) {
    const actor = await this.prisma.employee.findUnique({
      where: { id: actorId },
    });
    if (!actor) throw new NotFoundException('Employee not found');

    if (dto.scope === AnnouncementScope.DEPARTMENT && !dto.departmentId) {
      throw new BadRequestException(
        'departmentId is required when scope is DEPARTMENT',
      );
    }
    if (dto.scope === AnnouncementScope.LOCATION && !dto.locationId) {
      throw new BadRequestException(
        'locationId is required when scope is LOCATION',
      );
    }

    const targets = await this.resolveTargets(
      actor.companyId,
      dto.scope,
      dto.departmentId,
      dto.locationId,
    );

    const announcement = await this.prisma.announcement.create({
      data: {
        companyId: actor.companyId,
        title: dto.title,
        body: dto.body,
        scope: dto.scope,
        departmentId:
          dto.scope === AnnouncementScope.DEPARTMENT
            ? dto.departmentId
            : undefined,
        locationId:
          dto.scope === AnnouncementScope.LOCATION ? dto.locationId : undefined,
        priority: dto.priority,
        isPinned: dto.isPinned ?? false,
        requiresAck: dto.requiresAck ?? false,
        createdBy: actorId,
        // Section 7.12 Acceptance Criteria: "Mandatory announcement
        // compliance accurately reflects per-employee read status" — one
        // Ack row per targeted employee, created now so compliance-% is an
        // exact count rather than an approximation.
        ...(dto.requiresAck && {
          acks: { create: targets.map((t) => ({ employeeId: t.id })) },
        }),
      },
    });

    await Promise.all(
      targets.map((t) =>
        this.notifications.send({
          recipientId: t.id,
          template: 'announcements.created',
          data: { announcementId: announcement.id },
        }),
      ),
    );

    return announcement;
  }

  // Section 6 Access Control / Acceptance Criteria: "Targeted announcements
  // are visible only to the intended scope." HR Admin/Super Admin see
  // everything in their company as a privileged override; everyone else
  // only sees ORGANIZATION-wide announcements plus ones scoped to their own
  // department/location.
  async listAnnouncements(actorId: string, actorRole?: Role) {
    const actor = await this.prisma.employee.findUnique({
      where: { id: actorId },
    });
    if (!actor) throw new NotFoundException('Employee not found');

    const where: Prisma.AnnouncementWhereInput = { companyId: actor.companyId };
    if (!isPrivileged(actorRole)) {
      where.OR = [
        { scope: AnnouncementScope.ORGANIZATION },
        {
          scope: AnnouncementScope.DEPARTMENT,
          departmentId: actor.departmentId,
        },
        { scope: AnnouncementScope.LOCATION, locationId: actor.locationId },
      ];
    }

    const announcements = await this.prisma.announcement.findMany({
      where,
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    });

    // Not part of the PRD's Ack/compliance data model — purely a per-viewer
    // convenience so the UI can render "Acknowledge" vs "Acknowledged"
    // without a second round-trip per announcement.
    return this.attachMyAck(announcements, actorId);
  }

  private async attachMyAck<T extends { id: string; requiresAck: boolean }>(
    announcements: T[],
    actorId: string,
  ) {
    const requireAckIds = announcements
      .filter((a) => a.requiresAck)
      .map((a) => a.id);
    const myAcks = requireAckIds.length
      ? await this.prisma.announcementAck.findMany({
          where: { employeeId: actorId, announcementId: { in: requireAckIds } },
        })
      : [];
    const byAnnouncementId = new Map(myAcks.map((a) => [a.announcementId, a]));

    return announcements.map((a) => ({
      ...a,
      myAck: byAnnouncementId.get(a.id)
        ? { acknowledgedAt: byAnnouncementId.get(a.id)!.acknowledgedAt }
        : null,
    }));
  }

  private assertVisible(
    announcement: {
      scope: AnnouncementScope;
      departmentId: string | null;
      locationId: string | null;
    },
    actor: { departmentId: string | null; locationId: string | null },
    actorRole?: Role,
  ): void {
    if (isPrivileged(actorRole)) return;
    if (announcement.scope === AnnouncementScope.ORGANIZATION) return;
    if (
      announcement.scope === AnnouncementScope.DEPARTMENT &&
      announcement.departmentId === actor.departmentId
    ) {
      return;
    }
    if (
      announcement.scope === AnnouncementScope.LOCATION &&
      announcement.locationId === actor.locationId
    ) {
      return;
    }
    throw new ForbiddenException(
      'This announcement is outside your visibility scope',
    );
  }

  async getAnnouncement(id: string, actorId: string, actorRole?: Role) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
    });
    if (!announcement) throw new NotFoundException('Announcement not found');

    const actor = await this.prisma.employee.findUnique({
      where: { id: actorId },
    });
    if (!actor) throw new NotFoundException('Employee not found');
    this.assertVisible(announcement, actor, actorRole);

    const [withMyAck] = await this.attachMyAck([announcement], actorId);
    return withMyAck;
  }

  // Ack rows only exist for employees who were actually targeted, so a
  // missing row (rather than a role check) is what naturally enforces
  // "you can only acknowledge an announcement aimed at you."
  async ackAnnouncement(id: string, actorId: string) {
    const ack = await this.prisma.announcementAck.findUnique({
      where: {
        announcementId_employeeId: { announcementId: id, employeeId: actorId },
      },
    });
    if (!ack) {
      throw new NotFoundException(
        'This announcement was not found or does not target you',
      );
    }
    if (ack.acknowledgedAt) return ack;

    return this.prisma.announcementAck.update({
      where: { id: ack.id },
      data: { acknowledgedAt: new Date() },
    });
  }

  // Section 7.12 Acceptance Criteria: "Mandatory announcement compliance
  // accurately reflects per-employee read status."
  async getCompliance(id: string) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
    });
    if (!announcement) throw new NotFoundException('Announcement not found');

    const totalTargeted = await this.prisma.announcementAck.count({
      where: { announcementId: id },
    });
    const acknowledged = await this.prisma.announcementAck.count({
      where: { announcementId: id, acknowledgedAt: { not: null } },
    });
    const pending = totalTargeted - acknowledged;
    const compliancePercentage =
      totalTargeted === 0
        ? 100
        : Math.round((acknowledged / totalTargeted) * 100);

    return { totalTargeted, acknowledged, pending, compliancePercentage };
  }

  // HR Admin compliance user list — who has/hasn't acknowledged.
  async getComplianceUsers(id: string) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
    });
    if (!announcement) throw new NotFoundException('Announcement not found');

    const acks = await this.prisma.announcementAck.findMany({
      where: { announcementId: id },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { employee: { firstName: 'asc' } },
    });

    return acks.map((a) => ({
      employeeId: a.employee.id,
      employeeCode: a.employee.employeeCode,
      firstName: a.employee.firstName,
      lastName: a.employee.lastName,
      acknowledged: !!a.acknowledgedAt,
      acknowledgedAt: a.acknowledgedAt,
    }));
  }

  // Section 7.12 Business Rule: "Mandatory unread reminder → T+2 days."
  // Marks remindedAt once so a later sweep doesn't re-notify (same
  // idempotency shape as HelpdeskService.runSlaSweep()).
  async findDueReminders() {
    const cutoff = addDays(new Date(), -REMINDER_DELAY_DAYS);
    const due = await this.prisma.announcementAck.findMany({
      where: {
        acknowledgedAt: null,
        remindedAt: null,
        announcement: { createdAt: { lte: cutoff } },
      },
      include: { announcement: true },
    });

    const reminded: Array<(typeof due)[number]> = [];
    for (const ack of due) {
      const updated = await this.prisma.announcementAck.update({
        where: { id: ack.id },
        data: { remindedAt: new Date() },
      });
      reminded.push({ ...updated, announcement: ack.announcement });
    }
    return reminded;
  }

  async createRecognition(dto: CreateRecognitionDto, actorId: string) {
    if (dto.recipientId === actorId) {
      throw new BadRequestException('You cannot send recognition to yourself');
    }
    const recipient = await this.prisma.employee.findUnique({
      where: { id: dto.recipientId },
    });
    if (!recipient) throw new NotFoundException('Recipient not found');

    const recognition = await this.prisma.recognition.create({
      data: {
        senderId: actorId,
        recipientId: dto.recipientId,
        message: dto.message,
        category: dto.category,
        departmentId: dto.departmentId,
      },
    });

    const notifyTargets = [recipient.id, recipient.reportingManagerId].filter(
      (id): id is string => !!id,
    );
    await Promise.all(
      notifyTargets.map((recipientId) =>
        this.notifications.send({
          recipientId,
          template:
            recipientId === recipient.id
              ? 'recognition.received'
              : 'recognition.manager-notified',
          data: { recognitionId: recognition.id },
        }),
      ),
    );

    return recognition;
  }

  // Section 6 Access Control: a department-restricted entry is only visible
  // to that department's members (plus HR Admin/Super Admin); everything
  // else is public kudos.
  async listRecognitionFeed(actorId: string, actorRole?: Role) {
    const actor = await this.prisma.employee.findUnique({
      where: { id: actorId },
    });
    if (!actor) throw new NotFoundException('Employee not found');

    const where: Prisma.RecognitionWhereInput = isPrivileged(actorRole)
      ? {}
      : { OR: [{ departmentId: null }, { departmentId: actor.departmentId }] };

    return this.prisma.recognition.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }
}
