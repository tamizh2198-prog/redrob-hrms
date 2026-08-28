import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationPayload } from '../../shared/notifications/notification.service';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { ListInboxQueryDto } from './dto/list-inbox-query.dto';

// Section 7.16 Business Rule: "security/compliance-critical events always
// deliver via email regardless of preference" — there's no configurable
// NotificationTemplate catalog in this build (see module notes below), so
// the allowlist is matched against the literal template prefix instead.
const CRITICAL_TEMPLATE_PREFIXES = [
  'auth.password-reset',
  'auth.mfa-reset',
  'auth.permission-changed',
];

const ALL_CHANNELS: NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
  NotificationChannel.SLACK,
  NotificationChannel.SMS,
];

// Every template prefix any module currently emits (Section 7.16 Objective:
// "employees configure their own channel preferences" per event category) —
// surfaced so the preferences screen has something to render even before an
// employee has customized anything. Hardcoded rather than derived from a
// template catalog table, since none exists in this build.
const EVENT_CATEGORIES = [
  'AUTH',
  'EMPLOYEE',
  'PROFILE-CHANGE',
  'PROFILE-COMPLETION',
  'ROSTER',
  'SHIFT-SWAP',
  'WFO-WFH-REQUEST',
  'HOLIDAY',
  'HOLIDAY-CALENDAR',
  'ATS',
  'ONBOARDING',
  'PERFORMANCE',
  'ASSETS',
  'OFFBOARDING',
  'HELPDESK',
  'ANNOUNCEMENTS',
  'RECOGNITION',
  'ANALYTICS',
  'ASSISTANT',
  'DOCUMENT',
  'WORKFLOW',
  'SETTINGS',
];

// Event category is derived from the template's module prefix (e.g.
// "leave.decision-made" -> "LEAVE") so a single NotificationPreference row
// per employee per category covers every template that module ever emits,
// without needing an explicit template catalog table.
function eventCategoryOf(template: string): string {
  return template.split('.')[0].toUpperCase();
}

function isCritical(template: string): boolean {
  return CRITICAL_TEMPLATE_PREFIXES.some((prefix) =>
    template.startsWith(prefix),
  );
}

function humanize(template: string): string {
  return template.replace(/[.-]/g, ' ');
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // The real implementation behind the shared NotificationService.send()
  // stub every other module already calls (Section 7.16 Objective: "single
  // shared notification service consumed by every module"). Persists a real
  // in-app Notification row for the IN_APP channel; EMAIL/SLACK/SMS are
  // simulated via a NotificationLog entry each, since no mailer/SMS/Slack SDK
  // exists in this stack — one channel's (simulated) failure never blocks
  // another (Section 7.16 Workflow).
  async dispatch(payload: NotificationPayload): Promise<void> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: payload.recipientId },
    });
    // Some call sites still pass a placeholder like "hr-admin" when no real
    // agent/approver is configured yet (e.g. HelpdeskService's unassigned-
    // queue fallback) — there's no employee to notify, so this is a
    // deliberate no-op rather than a thrown error.
    if (!employee) return;

    const category = eventCategoryOf(payload.template);
    const preference = await this.prisma.notificationPreference.findUnique({
      where: {
        employeeId_eventCategory: {
          employeeId: employee.id,
          eventCategory: category,
        },
      },
    });
    // No row = every channel enabled by default (opt-out, not opt-in).
    const enabledChannels = preference?.channelsEnabled ?? ALL_CHANNELS;
    const channelsToDispatch = isCritical(payload.template)
      ? Array.from(new Set([...enabledChannels, NotificationChannel.EMAIL]))
      : enabledChannels;

    if (channelsToDispatch.includes(NotificationChannel.IN_APP)) {
      await this.prisma.notification.create({
        data: {
          companyId: employee.companyId,
          employeeId: employee.id,
          template: payload.template,
          title: humanize(payload.template),
          body: payload.body,
          data: payload.data as Prisma.InputJsonValue | undefined,
        },
      });
    }

    const simulatedChannels = channelsToDispatch.filter(
      (channel) => channel !== NotificationChannel.IN_APP,
    );
    if (simulatedChannels.length) {
      await this.prisma.notificationLog.createMany({
        data: simulatedChannels.map((channel) => ({
          employeeId: employee.id,
          template: payload.template,
          channel,
          status: NotificationDeliveryStatus.SENT,
        })),
      });
    }
  }

  async listInbox(employeeId: string, query: ListInboxQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.NotificationWhereInput = {
      employeeId,
      ...(query.unreadOnly && { readAt: null }),
    };

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { employeeId, readAt: null } }),
    ]);

    return { items, total, page, pageSize, unreadCount };
  }

  async markRead(id: string, employeeId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification) throw new NotFoundException('Notification not found');
    if (notification.employeeId !== employeeId) {
      throw new ForbiddenException(
        'Not authorized to modify this notification',
      );
    }
    if (notification.readAt) return notification;

    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(employeeId: string) {
    await this.prisma.notification.updateMany({
      where: { employeeId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }

  async getPreferences(employeeId: string) {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { employeeId },
    });
    const byCategory = new Map(
      rows.map((row) => [row.eventCategory, row.channelsEnabled]),
    );
    return EVENT_CATEGORIES.map((eventCategory) => ({
      eventCategory,
      channelsEnabled: byCategory.get(eventCategory) ?? ALL_CHANNELS,
    }));
  }

  async updatePreferences(employeeId: string, dto: UpdatePreferencesDto) {
    return this.prisma.notificationPreference.upsert({
      where: {
        employeeId_eventCategory: {
          employeeId,
          eventCategory: dto.eventCategory,
        },
      },
      update: { channelsEnabled: dto.channelsEnabled },
      create: {
        employeeId,
        eventCategory: dto.eventCategory,
        channelsEnabled: dto.channelsEnabled,
      },
    });
  }

  // Section 7.16 Reports: "delivery success/failure rate by channel;
  // notification volume by event type."
  async getDeliveryReport() {
    const logs = await this.prisma.notificationLog.findMany();
    const volumeByTemplate: Record<string, number> = {};
    const byChannel: Record<string, { sent: number; failed: number }> = {};

    for (const log of logs) {
      volumeByTemplate[log.template] =
        (volumeByTemplate[log.template] ?? 0) + 1;
      byChannel[log.channel] ??= { sent: 0, failed: 0 };
      if (log.status === NotificationDeliveryStatus.FAILED) {
        byChannel[log.channel].failed++;
      } else {
        byChannel[log.channel].sent++;
      }
    }

    const inAppCount = await this.prisma.notification.count();
    return { volumeByTemplate, byChannel, inAppCount };
  }
}
