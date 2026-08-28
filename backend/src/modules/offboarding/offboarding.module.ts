import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { OffboardingController } from './offboarding.controller';
import { OffboardingService } from './offboarding.service';

@Module({
  imports: [AssetsModule],
  controllers: [OffboardingController],
  providers: [OffboardingService],
})
export class OffboardingModule {}
