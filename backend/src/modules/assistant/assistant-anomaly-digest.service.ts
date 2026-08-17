import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AttendanceStatus, LeaveApplicationStatus, Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';

// Section 7.14 Key Feature: "Proactive anomaly flags to HR Admin: unusual
// absenteeism spikes, a cluster of pending approvals aging past SLA, a
// spike in helpdesk tickets on one topic." Thresholds are simple
// week-over-week comparisons — no ML/anomaly-detection dependency needed
// for what the PRD describes ("a 40% jump in IT ticket volume").
const ABSENTEEISM_SPIKE_RATIO = 0.4;
const TICKET_SPIKE_RATIO = 0.4;
const PENDING_APPROVAL_AGING_DAYS = 3;

@Injectable()
export class AssistantAnomalyDigestService {
  private readonly logger = new Logger(AssistantAnomalyDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_WEEK)
  async sendWeeklyAnomalyDigest(): Promise<void> {
    const companies = await this.prisma.company.findMany({
      select: { id: true },
    });

    let digestsSent = 0;
    for (const company of companies) {
      const anomalies = await this.computeAnomalies(company.id);
      if (anomalies.length === 0) continue;

      const hrAdmins = await this.prisma.employee.findMany({
        where: {
          companyId: company.id,
          role: { in: [Role.HR_ADMIN, Role.SUPER_ADMIN] },
        },
        select: { id: true },
      });
      for (const admin of hrAdmins) {
        await this.notifications.send({
          recipientId: admin.id,
          template: 'assistant.anomaly-digest',
          body: `Weekly anomaly digest: ${anomalies.join('; ')}`,
          data: { anomalies },
        });
        digestsSent++;
      }
    }

    if (digestsSent > 0) {
      this.logger.log(
        `Sent ${digestsSent} weekly anomaly digest notification(s)`,
      );
    }
  }

  async computeAnomalies(companyId: string): Promise<string[]> {
    const anomalies: string[] = [];
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const [thisWeekAbsences, lastWeekAbsences] = await Promise.all([
      this.prisma.attendanceRecord.count({
        where: {
          employee: { companyId },
          status: AttendanceStatus.ABSENT,
          date: { gte: weekAgo, lte: now },
        },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          employee: { companyId },
          status: AttendanceStatus.ABSENT,
          date: { gte: twoWeeksAgo, lt: weekAgo },
        },
      }),
    ]);
    if (
      lastWeekAbsences > 0 &&
      (thisWeekAbsences - lastWeekAbsences) / lastWeekAbsences >=
        ABSENTEEISM_SPIKE_RATIO
    ) {
      anomalies.push(
        `Absenteeism spike: ${thisWeekAbsences} absence(s) this week vs ${lastWeekAbsences} last week`,
      );
    }

    const agingCutoff = new Date(
      now.getTime() - PENDING_APPROVAL_AGING_DAYS * 24 * 60 * 60 * 1000,
    );
    const agingApprovals = await this.prisma.leaveApplication.count({
      where: {
        status: LeaveApplicationStatus.PENDING,
        createdAt: { lte: agingCutoff },
        employee: { companyId },
      },
    });
    if (agingApprovals > 0) {
      anomalies.push(
        `${agingApprovals} leave approval(s) pending more than ${PENDING_APPROVAL_AGING_DAYS} days`,
      );
    }

    const [thisWeekByCategory, lastWeekByCategory] = await Promise.all([
      this.prisma.ticket.groupBy({
        by: ['category'],
        where: {
          employee: { companyId },
          createdAt: { gte: weekAgo, lte: now },
        },
        _count: true,
      }),
      this.prisma.ticket.groupBy({
        by: ['category'],
        where: {
          employee: { companyId },
          createdAt: { gte: twoWeeksAgo, lt: weekAgo },
        },
        _count: true,
      }),
    ]);
    const lastWeekMap = new Map(
      lastWeekByCategory.map((c) => [c.category, c._count]),
    );
    for (const c of thisWeekByCategory) {
      const prev = lastWeekMap.get(c.category) ?? 0;
      if (prev > 0 && (c._count - prev) / prev >= TICKET_SPIKE_RATIO) {
        anomalies.push(
          `Helpdesk ticket spike in ${c.category}: ${c._count} this week vs ${prev} last week`,
        );
      }
    }

    return anomalies;
  }
}
