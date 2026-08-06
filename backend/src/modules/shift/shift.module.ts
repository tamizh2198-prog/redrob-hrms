import { Module } from '@nestjs/common';
import { ShiftController } from './shift.controller';
import { RosterController } from './roster.controller';
import { ShiftService } from './shift.service';

@Module({
  controllers: [ShiftController, RosterController],
  providers: [ShiftService],
  exports: [ShiftService],
})
export class ShiftModule {}
