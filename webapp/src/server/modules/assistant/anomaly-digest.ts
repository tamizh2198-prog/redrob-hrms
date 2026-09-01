import type { PrismaClient } from "@prisma/client";
import { notify } from "../../lib/notify";

// Key Feature: "Proactive anomaly flags to HR Admin: a spike in helpdesk
// tickets on one topic." Thresholds are simple week-over-week comparisons —
// no ML/anomaly-detection dependency needed for what the PRD describes ("a
// 40% jump in IT ticket volume").
const TICKET_SPIKE_RATIO = 0.4;

export async function computeAnomalies(prisma: PrismaClient, companyId: string): Promise<string[]> {
  const anomalies: string[] = [];
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [thisWeekByCategory, lastWeekByCategory] = await Promise.all([
    prisma.ticket.groupBy({
      by: ["category"],
      where: { employee: { companyId }, createdAt: { gte: weekAgo, lte: now } },
      _count: true,
    }),
    prisma.ticket.groupBy({
      by: ["category"],
      where: { employee: { companyId }, createdAt: { gte: twoWeeksAgo, lt: weekAgo } },
      _count: true,
    }),
  ]);
  const lastWeekMap = new Map(lastWeekByCategory.map((c) => [c.category, c._count]));
  for (const c of thisWeekByCategory) {
    const prev = lastWeekMap.get(c.category) ?? 0;
    if (prev > 0 && (c._count - prev) / prev >= TICKET_SPIKE_RATIO) {
      anomalies.push(`Helpdesk ticket spike in ${c.category}: ${c._count} this week vs ${prev} last week`);
    }
  }

  return anomalies;
}

export async function sendWeeklyAnomalyDigest(prisma: PrismaClient): Promise<void> {
  const companies = await prisma.company.findMany({ select: { id: true } });

  let digestsSent = 0;
  for (const company of companies) {
    const anomalies = await computeAnomalies(prisma, company.id);
    if (anomalies.length === 0) continue;

    const hrAdmins = await prisma.employee.findMany({
      where: { companyId: company.id, role: { in: ["HR_ADMIN", "SUPER_ADMIN"] } },
      select: { id: true },
    });
    for (const admin of hrAdmins) {
      await notify(prisma, {
        recipientId: admin.id,
        template: "assistant.anomaly-digest",
        body: `Weekly anomaly digest: ${anomalies.join("; ")}`,
        data: { anomalies },
      });
      digestsSent++;
    }
  }

  if (digestsSent > 0) {
    console.log(`Sent ${digestsSent} weekly anomaly digest notification(s)`);
  }
}
