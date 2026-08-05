import { Controller } from '@nestjs/common';
import { HelpdeskService } from './helpdesk.service';

@Controller('helpdesk')
export class HelpdeskController {
  constructor(private readonly helpdeskService: HelpdeskService) {}
}
