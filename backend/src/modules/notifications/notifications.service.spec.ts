import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../shared/database/prisma.service';

function createMockPrisma() {
  return {
    employee: {
      findUnique: jest.fn(),
    },
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    notificationPreference: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    notificationLog: {
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('NotificationsService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new NotificationsService(prisma as unknown as PrismaService);
  });

  describe('Section 7.16 Objective: the real implementation behind NotificationService.send()', () => {
    it('is a no-op when the recipient does not resolve to a real employee', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await service.dispatch({
        recipientId: 'hr-admin',
        template: 'helpdesk.ticket-created',
      });

      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(prisma.notificationLog.createMany).not.toHaveBeenCalled();
    });

    it('creates an in-app notification and simulated logs for the other default-enabled channels', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        companyId: 'company-1',
      });
      prisma.notificationPreference.findUnique.mockResolvedValue(null);

      await service.dispatch({
        recipientId: 'emp-1',
        template: 'leave.decision-made',
        data: { approved: true },
      });

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            employeeId: 'emp-1',
            template: 'leave.decision-made',
          }),
        }),
      );
      expect(prisma.notificationLog.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ channel: 'EMAIL' }),
            expect.objectContaining({ channel: 'SLACK' }),
            expect.objectContaining({ channel: 'SMS' }),
          ]),
        }),
      );
    });

    it('respects a per-employee channel opt-out and skips the in-app row when IN_APP is disabled', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        companyId: 'company-1',
      });
      prisma.notificationPreference.findUnique.mockResolvedValue({
        channelsEnabled: ['EMAIL'],
      });

      await service.dispatch({
        recipientId: 'emp-1',
        template: 'leave.decision-made',
      });

      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(prisma.notificationLog.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ channel: 'EMAIL' })],
        }),
      );
    });

    it('always forces EMAIL for a critical template even if the employee opted out of every channel', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        companyId: 'company-1',
      });
      prisma.notificationPreference.findUnique.mockResolvedValue({
        channelsEnabled: ['IN_APP'],
      });

      await service.dispatch({
        recipientId: 'emp-1',
        template: 'auth.password-reset',
      });

      expect(prisma.notificationLog.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ channel: 'EMAIL' })],
        }),
      );
    });
  });

  describe('inbox', () => {
    it('scopes listInbox to the requesting employee and reports the unread count', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(3);

      const result = await service.listInbox('emp-1', {});

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { employeeId: 'emp-1' } }),
      );
      expect(result.unreadCount).toBe(3);
    });

    it("rejects marking another employee's notification as read", async () => {
      prisma.notification.findUnique.mockResolvedValue({
        id: 'notif-1',
        employeeId: 'someone-else',
        readAt: null,
      });

      await expect(service.markRead('notif-1', 'emp-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException for a notification that does not exist', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);

      await expect(service.markRead('missing', 'emp-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('is idempotent when marking an already-read notification as read', async () => {
      const existing = {
        id: 'notif-1',
        employeeId: 'emp-1',
        readAt: new Date(),
      };
      prisma.notification.findUnique.mockResolvedValue(existing);

      const result = await service.markRead('notif-1', 'emp-1');

      expect(result).toBe(existing);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });
  });

  describe('preferences', () => {
    it('defaults every category to all channels enabled when no preference rows exist', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);

      const result = await service.getPreferences('emp-1');

      expect(
        result.find((r) => r.eventCategory === 'LEAVE')?.channelsEnabled,
      ).toEqual(['IN_APP', 'EMAIL', 'SLACK', 'SMS']);
    });

    it('upserts a preference row for the given employee/category', async () => {
      await service.updatePreferences('emp-1', {
        eventCategory: 'LEAVE',
        channelsEnabled: ['IN_APP'] as any,
      });

      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            employeeId_eventCategory: {
              employeeId: 'emp-1',
              eventCategory: 'LEAVE',
            },
          },
        }),
      );
    });
  });

  describe('Section 7.16 Reports: delivery volume/success-failure by channel', () => {
    it('aggregates NotificationLog rows by template and channel', async () => {
      prisma.notificationLog.findMany.mockResolvedValue([
        { template: 'leave.decision-made', channel: 'EMAIL', status: 'SENT' },
        { template: 'leave.decision-made', channel: 'SLACK', status: 'FAILED' },
      ]);
      prisma.notification.count.mockResolvedValue(5);

      const report = await service.getDeliveryReport();

      expect(report.volumeByTemplate['leave.decision-made']).toBe(2);
      expect(report.byChannel.EMAIL).toEqual({ sent: 1, failed: 0 });
      expect(report.byChannel.SLACK).toEqual({ sent: 0, failed: 1 });
      expect(report.inAppCount).toBe(5);
    });
  });
});
