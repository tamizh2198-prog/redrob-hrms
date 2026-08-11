import { AnalyticsReportSchedulerService } from './analytics-report-scheduler.service';
import { AnalyticsService } from './analytics.service';
import { NotificationService } from '../../shared/notifications/notification.service';

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

function createMockAnalyticsService() {
  return { findDueScheduledReports: jest.fn() };
}

describe('AnalyticsReportSchedulerService (Section 7.13 Phase 5)', () => {
  let notifications: ReturnType<typeof createMockNotifications>;
  let analyticsService: ReturnType<typeof createMockAnalyticsService>;
  let scheduler: AnalyticsReportSchedulerService;

  beforeEach(() => {
    notifications = createMockNotifications();
    analyticsService = createMockAnalyticsService();
    scheduler = new AnalyticsReportSchedulerService(
      notifications as unknown as NotificationService,
      analyticsService as unknown as AnalyticsService,
    );
  });

  it('sends one notification per re-validated recipient, not per original recipient', async () => {
    analyticsService.findDueScheduledReports.mockResolvedValue([
      {
        savedReportId: 'sr-1',
        name: 'Weekly headcount',
        total: 42,
        recipientCount: 3,
        validRecipientIds: ['hr-1'],
      },
    ]);

    await scheduler.sendDueScheduledReports();

    expect(notifications.send).toHaveBeenCalledTimes(1);
    expect(notifications.send).toHaveBeenCalledWith({
      recipientId: 'hr-1',
      template: 'analytics.saved-report-ready',
      data: { savedReportId: 'sr-1', name: 'Weekly headcount', total: 42 },
    });
  });

  it('sends nothing when no reports are due', async () => {
    analyticsService.findDueScheduledReports.mockResolvedValue([]);
    await scheduler.sendDueScheduledReports();
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('never throws even when every recipient was dropped by the RBAC re-check', async () => {
    analyticsService.findDueScheduledReports.mockResolvedValue([
      {
        savedReportId: 'sr-1',
        name: 'Weekly headcount',
        total: 5,
        recipientCount: 2,
        validRecipientIds: [],
      },
    ]);

    await expect(scheduler.sendDueScheduledReports()).resolves.not.toThrow();
    expect(notifications.send).not.toHaveBeenCalled();
  });
});
