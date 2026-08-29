import { Module } from '@nestjs/common';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';
import { PerformanceKpiReleaseService } from './performance-kpi-release.service';

@Module({
  controllers: [PerformanceController],
  providers: [PerformanceService, PerformanceKpiReleaseService],
})
export class PerformanceModule {}
