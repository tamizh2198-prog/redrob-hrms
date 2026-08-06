import { Module } from '@nestjs/common';
import { AuthModule } from '../../shared/auth/auth.module';
import { EmployeeModule } from '../employee/employee.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { AtsController } from './ats.controller';
import { AtsService } from './ats.service';

@Module({
  imports: [AuthModule, EmployeeModule, OnboardingModule],
  controllers: [AtsController],
  providers: [AtsService],
})
export class AtsModule {}
