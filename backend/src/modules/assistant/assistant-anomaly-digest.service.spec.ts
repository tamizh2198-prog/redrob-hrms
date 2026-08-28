import { AssistantAnomalyDigestService } from './assistant-anomaly-digest.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';

function createMockPrisma() {
  return {
    company: { findMany: jest.fn() },
    employee: { findMany: jest.fn() },
    ticket: { groupBy: jest.fn() },
  };
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

describe('AssistantAnomalyDigestService (Section 7.14)', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let service: AssistantAnomalyDigestService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    service = new AssistantAnomalyDigestService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationService,
    );
    prisma.ticket.groupBy.mockResolvedValue([]);
  });

  it('flags a helpdesk ticket-category spike >= 40%', async () => {
    prisma.ticket.groupBy
      .mockResolvedValueOnce([{ category: 'IT_SUPPORT', _count: 14 }])
      .mockResolvedValueOnce([{ category: 'IT_SUPPORT', _count: 10 }]);
    const anomalies = await service.computeAnomalies('co-1');
    expect(anomalies.some((a) => a.includes('IT_SUPPORT'))).toBe(true);
  });

  it('sends the digest only to HR_ADMIN/SUPER_ADMIN employees of companies with anomalies', async () => {
    prisma.company.findMany.mockResolvedValue([{ id: 'co-1' }, { id: 'co-2' }]);
    prisma.ticket.groupBy
      .mockResolvedValueOnce([{ category: 'IT_SUPPORT', _count: 14 }])
      .mockResolvedValueOnce([{ category: 'IT_SUPPORT', _count: 10 }]) // co-1: spike
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // co-2: no data, no anomaly
    prisma.employee.findMany.mockResolvedValue([{ id: 'hr-1' }]);

    await service.sendWeeklyAnomalyDigest();

    expect(notifications.send).toHaveBeenCalledTimes(1);
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'hr-1',
        template: 'assistant.anomaly-digest',
      }),
    );
  });

  it('sends nothing when no company has any anomaly', async () => {
    prisma.company.findMany.mockResolvedValue([{ id: 'co-1' }]);
    await service.sendWeeklyAnomalyDigest();
    expect(notifications.send).not.toHaveBeenCalled();
  });
});
