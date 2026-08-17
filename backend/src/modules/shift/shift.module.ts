import { Module } from '@nestjs/common';
import { ShiftController } from './shift.controller';
import { RosterController } from './roster.controller';
import { WfoWfhRequestController } from './wfo-wfh-request.controller';
import { ShiftService } from './shift.service';
import { WfoWfhRequestService } from './wfo-wfh-request.service';

@Module({
  controllers: [ShiftController, RosterController, WfoWfhRequestController],
  providers: [ShiftService, WfoWfhRequestService],
  exports: [ShiftService],
})
export class ShiftModule {}
