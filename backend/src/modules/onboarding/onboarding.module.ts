import { Module } from '@nestjs/common';
import { AuthModule } from '../../shared/auth/auth.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { ProbationFeedbackReminderService } from './probation-feedback-reminder.service';

@Module({
  imports: [AuthModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, ProbationFeedbackReminderService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
