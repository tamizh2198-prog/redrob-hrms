import { Module } from '@nestjs/common';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { DocumentExpiryService } from './document-expiry.service';

@Module({
  controllers: [EmployeeController],
  providers: [EmployeeService, DocumentExpiryService],
  exports: [EmployeeService],
})
export class EmployeeModule {}
