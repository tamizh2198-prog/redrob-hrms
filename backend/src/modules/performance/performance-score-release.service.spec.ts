import { PerformanceScoreReleaseService } from './performance-score-release.service';
import { PerformanceService } from './performance.service';
import { NotificationService } from '../../shared/notifications/notification.service';

function createMockPerformanceService() {
  return {
    findDueMonthlyReleases: jest.fn().mockResolvedValue([]),
    markMonthlyReleaseNotified: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

describe('PerformanceScoreReleaseService', () => {
  let performanceService: ReturnType<typeof createMockPerformanceService>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let service: PerformanceScoreReleaseService;

  beforeEach(() => {
    performanceService = createMockPerformanceService();
    notifications = createMockNotifications();
    service = new PerformanceScoreReleaseService(
      performanceService as unknown as PerformanceService,
      notifications as unknown as NotificationService,
    );
  });

  it('notifies each due monthly score and marks it notified exactly once', async () => {
    performanceService.findDueMonthlyReleases.mockResolvedValue([
      { id: 'eval-1', employeeId: 'emp-1', period: new Date('2026-08-01') },
    ]);

    await service.releaseDueScores();

    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'emp-1', template: 'performance.monthly-score-released' }),
    );
    expect(performanceService.markMonthlyReleaseNotified).toHaveBeenCalledWith('eval-1');
  });

  it('does nothing when nothing is due', async () => {
    await service.releaseDueScores();

    expect(notifications.send).not.toHaveBeenCalled();
  });
});
