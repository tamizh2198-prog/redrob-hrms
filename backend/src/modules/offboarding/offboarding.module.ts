import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { AssetsModule } from '../assets/assets.module';
import { OffboardingController } from './offboarding.controller';
import { OffboardingService } from './offboarding.service';

@Module({
  imports: [LeaveModule, AssetsModule],
  controllers: [OffboardingController],
  providers: [OffboardingService],
})
export class OffboardingModule {}
