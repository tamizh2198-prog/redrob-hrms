import { Module } from '@nestjs/common';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';
import { PerformanceScoreReleaseService } from './performance-score-release.service';

@Module({
  controllers: [PerformanceController],
  providers: [PerformanceService, PerformanceScoreReleaseService],
})
export class PerformanceModule {}
