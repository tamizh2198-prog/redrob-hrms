import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsReportSchedulerService } from './analytics-report-scheduler.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsReportSchedulerService],
})
export class AnalyticsModule {}
