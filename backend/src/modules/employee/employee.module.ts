import { Module } from '@nestjs/common';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { DocumentExpiryService } from './document-expiry.service';
import { ProfileCompletionReminderService } from './profile-completion-reminder.service';

@Module({
  controllers: [EmployeeController],
  providers: [
    EmployeeService,
    DocumentExpiryService,
    ProfileCompletionReminderService,
  ],
  exports: [EmployeeService],
})
export class EmployeeModule {}
