import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PerformanceService } from './performance.service';
import { NotificationService } from '../../shared/notifications/notification.service';

// Orchestration only — PerformanceService owns the "what's due" queries
// (findDueMonthlyReleases/findDueQuarterlyKpiReleases), same split as
// AnalyticsReportSchedulerService/WorkflowEscalationService. Release
// granularity is a calendar day, so a daily midnight cron (matching
// DocumentExpiryService's cadence) is fine.
@Injectable()
export class PerformanceKpiReleaseService {
  private readonly logger = new Logger(PerformanceKpiReleaseService.name);

  constructor(
    private readonly performanceService: PerformanceService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async releaseDueScores(): Promise<void> {
    const monthly = await this.performanceService.findDueMonthlyReleases();
    for (const evaluation of monthly) {
      await this.notifications.send({
        recipientId: evaluation.employeeId,
        template: 'performance.monthly-score-released',
        body: `Your monthly performance score for ${evaluation.period.toISOString().slice(0, 7)} is now available.`,
        data: { evaluationId: evaluation.id },
      });
      await this.performanceService.markMonthlyReleaseNotified(evaluation.id);
    }
    if (monthly.length > 0) {
      this.logger.log(`${monthly.length} monthly score(s) released`);
    }

    const quarterly = await this.performanceService.findDueQuarterlyKpiReleases();
    for (const kpi of quarterly) {
      await this.notifications.send({
        recipientId: kpi.employeeId,
        template: 'performance.quarterly-kpi-released',
        body: `Your Q${kpi.quarter} ${kpi.year} KPI result is now available.`,
        data: { kpiId: kpi.id },
      });
      await this.performanceService.markQuarterlyKpiReleaseNotified(kpi.id);
    }
    if (quarterly.length > 0) {
      this.logger.log(`${quarterly.length} quarterly KPI(s) released`);
    }
  }
}
