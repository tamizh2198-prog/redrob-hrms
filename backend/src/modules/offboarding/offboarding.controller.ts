import { Controller } from '@nestjs/common';
import { OffboardingService } from './offboarding.service';

@Controller('offboarding')
export class OffboardingController {
  constructor(private readonly offboardingService: OffboardingService) {}
}
