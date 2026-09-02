import type { PrismaClient, Prisma } from "@prisma/client";
import { NotificationChannel, NotificationDeliveryStatus } from "@prisma/client";
import { ForbiddenError, NotFoundError } from "../../lib/errors";
import { sendEmail } from "../../lib/email";
import type { ListInboxQueryDto, UpdatePreferencesDto } from "./dto";

// Section 7.16 Business Rule: "security/compliance-critical events always
// deliver via email regardless of preference" — there's no configurable
// NotificationTemplate catalog in this build, so the allowlist is matched
// against the literal template prefix instead.
const CRITICAL_TEMPLATE_PREFIXES = ["auth.password-reset", "auth.mfa-reset", "auth.permission-changed"];

const ALL_CHANNELS: NotificationChannel[] = [
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
  NotificationChannel.SLACK,
  NotificationChannel.SMS,
];

// Every template prefix any module currently emits — surfaced so the
// preferences screen has something to render even before an employee has
// customized anything.
const EVENT_CATEGORIES = [
  "AUTH",
  "EMPLOYEE",
  "PROFILE-CHANGE",
  "PROFILE-COMPLETION",
  "ROSTER",
  "SHIFT-SWAP",
  "WFO-WFH-REQUEST",
  "HOLIDAY",
  "HOLIDAY-CALENDAR",
  "ATS",
  "ONBOARDING",
  "PERFORMANCE",
  "ASSETS",
  "OFFBOARDING",
  "HELPDESK",
  "ANNOUNCEMENTS",
  "RECOGNITION",
  "ANALYTICS",
  "ASSISTANT",
  "DOCUMENT",
  "WORKFLOW",
  "SETTINGS",
];

function eventCategoryOf(template: string): string {
  return template.split(".")[0].toUpperCase();
}

function isCritical(template: string): boolean {
  return CRITICAL_TEMPLATE_PREFIXES.some((prefix) => template.startsWith(prefix));
}

function humanize(template: string): string {
  return template.replace(/[.-]/g, " ");
}

export interface NotificationPayload {
  recipientId: string;
  template: string;
  body: string;
  data?: Record<string, unknown>;
}

// The real implementation behind the shared notify() entry point every
// other module calls (see ../../lib/notify.ts). Persists a real in-app
// Notification row for the IN_APP channel. EMAIL is real for the three
// CRITICAL_TEMPLATE_PREFIXES (Section 7.16: "security/compliance-critical
// events always deliver via email regardless of preference") via the same
// Resend-backed sendEmail() the invitation/activation/offer flows already
// use; every other category's EMAIL, plus SLACK/SMS entirely, are still
// simulated via a NotificationLog entry, since no Slack/SMS SDK exists in
// this stack and non-critical email isn't wired up yet — one channel's
// failure never blocks another.
export async function dispatch(prisma: PrismaClient, payload: NotificationPayload): Promise<void> {
  const employee = await prisma.employee.findUnique({ where: { id: payload.recipientId } });
  // Some call sites still pass a placeholder like "hr-admin" when no real
  // agent/approver is configured yet — there's no employee to notify, so
  // this is a deliberate no-op rather than a thrown error.
  if (!employee) return;

  const category = eventCategoryOf(payload.template);
  const preference = await prisma.notificationPreference.findUnique({
    where: { employeeId_eventCategory: { employeeId: employee.id, eventCategory: category } },
  });
  // No row = every channel enabled by default (opt-out, not opt-in).
  const enabledChannels = preference?.channelsEnabled ?? ALL_CHANNELS;
  const critical = isCritical(payload.template);
  const channelsToDispatch = critical
    ? Array.from(new Set([...enabledChannels, NotificationChannel.EMAIL]))
    : enabledChannels;

  if (channelsToDispatch.includes(NotificationChannel.IN_APP)) {
    await prisma.notification.create({
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

  const otherChannels = channelsToDispatch.filter((channel) => channel !== NotificationChannel.IN_APP);
  if (otherChannels.length) {
    const logs = await Promise.all(
      otherChannels.map(async (channel) => {
        if (channel === NotificationChannel.EMAIL && critical) {
          if (!employee.workEmail) {
            return {
              employeeId: employee.id,
              template: payload.template,
              channel,
              status: NotificationDeliveryStatus.SKIPPED,
            };
          }
          const result = await sendEmail({
            to: employee.workEmail,
            subject: `Redrob HRMS: ${humanize(payload.template)}`,
            text: payload.body,
          });
          return {
            employeeId: employee.id,
            template: payload.template,
            channel,
            status: result.sent ? NotificationDeliveryStatus.SENT : NotificationDeliveryStatus.FAILED,
          };
        }
        return {
          employeeId: employee.id,
          template: payload.template,
          channel,
          status: NotificationDeliveryStatus.SENT,
        };
      }),
    );
    await prisma.notificationLog.createMany({ data: logs });
  }
}

export async function listInbox(prisma: PrismaClient, employeeId: string, query: ListInboxQueryDto) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const where: Prisma.NotificationWhereInput = {
    employeeId,
    ...(query.unreadOnly && { readAt: null }),
  };

  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { employeeId, readAt: null } }),
  ]);

  return { items, total, page, pageSize, unreadCount };
}

export async function markRead(prisma: PrismaClient, id: string, employeeId: string) {
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification) throw new NotFoundError("Notification not found");
  if (notification.employeeId !== employeeId) {
    throw new ForbiddenError("Not authorized to modify this notification");
  }
  if (notification.readAt) return notification;

  return prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
}

export async function markAllRead(prisma: PrismaClient, employeeId: string) {
  await prisma.notification.updateMany({
    where: { employeeId, readAt: null },
    data: { readAt: new Date() },
  });
  return { success: true };
}

export async function getPreferences(prisma: PrismaClient, employeeId: string) {
  const rows = await prisma.notificationPreference.findMany({ where: { employeeId } });
  const byCategory = new Map(rows.map((row) => [row.eventCategory, row.channelsEnabled]));
  return EVENT_CATEGORIES.map((eventCategory) => ({
    eventCategory,
    channelsEnabled: byCategory.get(eventCategory) ?? ALL_CHANNELS,
  }));
}

export async function updatePreferences(prisma: PrismaClient, employeeId: string, dto: UpdatePreferencesDto) {
  return prisma.notificationPreference.upsert({
    where: { employeeId_eventCategory: { employeeId, eventCategory: dto.eventCategory } },
    update: { channelsEnabled: dto.channelsEnabled },
    create: { employeeId, eventCategory: dto.eventCategory, channelsEnabled: dto.channelsEnabled },
  });
}

// Section 7.16 Reports: "delivery success/failure rate by channel;
// notification volume by event type."
export async function getDeliveryReport(prisma: PrismaClient) {
  const logs = await prisma.notificationLog.findMany();
  const volumeByTemplate: Record<string, number> = {};
  const byChannel: Record<string, { sent: number; failed: number }> = {};

  for (const log of logs) {
    volumeByTemplate[log.template] = (volumeByTemplate[log.template] ?? 0) + 1;
    byChannel[log.channel] ??= { sent: 0, failed: 0 };
    if (log.status === NotificationDeliveryStatus.FAILED) {
      byChannel[log.channel].failed++;
    } else {
      byChannel[log.channel].sent++;
    }
  }

  const inAppCount = await prisma.notification.count();
  return { volumeByTemplate, byChannel, inAppCount };
}
