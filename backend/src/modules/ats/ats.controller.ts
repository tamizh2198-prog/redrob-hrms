import { Controller } from '@nestjs/common';
import { AtsService } from './ats.service';

@Controller('ats')
export class AtsController {
  constructor(private readonly atsService: AtsService) {}
}
