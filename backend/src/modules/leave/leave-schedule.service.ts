import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LeaveService } from './leave.service';

@Injectable()
export class LeaveScheduleService {
  private readonly logger = new Logger(LeaveScheduleService.name);

  constructor(private readonly leaveService: LeaveService) {}

  @Cron('0 0 1 * *') // first of every month
  async runMonthlyAccrual(): Promise<void> {
    const now = new Date();
    const result = await this.leaveService.runMonthlyAccrual(
      now.getFullYear(),
      now.getMonth() + 1,
    );
    this.logger.log(`Monthly accrual run: ${JSON.stringify(result)}`);
  }

  @Cron('0 0 31 12 *') // Dec 31st
  async runYearEndClose(): Promise<void> {
    const result = await this.leaveService.runYearEndClose(
      new Date().getFullYear(),
    );
    this.logger.log(`Year-end close run: ${JSON.stringify(result)}`);
  }
}
