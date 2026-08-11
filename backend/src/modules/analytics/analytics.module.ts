import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsReportSchedulerService } from './analytics-report-scheduler.service';

@Module({
  imports: [LeaveModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsReportSchedulerService],
})
export class AnalyticsModule {}
