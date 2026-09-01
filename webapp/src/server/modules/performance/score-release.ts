import type { PrismaClient } from "@prisma/client";
import { notify } from "../../lib/notify";
import { findDueMonthlyReleases, markMonthlyReleaseNotified } from "./service";

export async function releaseDueScores(prisma: PrismaClient): Promise<void> {
  const monthly = await findDueMonthlyReleases(prisma);
  for (const evaluation of monthly) {
    await notify(prisma, {
      recipientId: evaluation.employeeId,
      template: "performance.monthly-score-released",
      body: `Your monthly performance score for ${evaluation.period.toISOString().slice(0, 7)} is now available.`,
      data: { evaluationId: evaluation.id },
    });
    await markMonthlyReleaseNotified(prisma, evaluation.id);
  }
  if (monthly.length > 0) {
    console.log(`${monthly.length} monthly score(s) released`);
  }
}
