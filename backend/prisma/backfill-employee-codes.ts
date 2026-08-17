/**
 * One-off backfill: renumber every existing Employee.employeeCode into the
 * MNR-<year>-<4-digit-seq> format (same format generateEmployeeCode() in
 * employee.service.ts uses for new hires). Codes are assigned in createdAt
 * order, restarting the sequence at 0001 for each distinct creation year.
 *
 * Run with DRY_RUN=1 first to preview the mapping, then without it to apply.
 *   DATABASE_URL=... npx ts-node prisma/backfill-employee-codes.ts          # DRY RUN
 *   DATABASE_URL=... RUN=1 npx ts-node prisma/backfill-employee-codes.ts    # APPLY
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const PREFIX = 'MNR';

async function main() {
  const apply = process.env.RUN === '1';

  const employees = await prisma.employee.findMany({
    select: { id: true, employeeCode: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const seqByYear = new Map<number, number>();
  const plan = employees.map((e) => {
    const year = e.createdAt.getFullYear();
    const next = (seqByYear.get(year) ?? 0) + 1;
    seqByYear.set(year, next);
    const newCode = `${PREFIX}-${year}-${String(next).padStart(4, '0')}`;
    return { id: e.id, oldCode: e.employeeCode, newCode };
  });

  const changed = plan.filter((p) => p.oldCode !== p.newCode);
  const unchanged = plan.length - changed.length;

  console.log(`Total employees: ${plan.length}`);
  console.log(`Already correct (no change): ${unchanged}`);
  console.log(`To be renumbered: ${changed.length}`);
  console.log('Sample of planned changes:');
  for (const p of changed.slice(0, 15)) {
    console.log(`  ${p.oldCode.padEnd(16)} -> ${p.newCode}`);
  }
  if (changed.length > 15) console.log(`  ... and ${changed.length - 15} more`);

  const newCodes = new Set(plan.map((p) => p.newCode));
  if (newCodes.size !== plan.length) {
    throw new Error('Planned new codes are not unique — aborting.');
  }

  if (!apply) {
    console.log('\nDRY RUN only — no changes written. Re-run with RUN=1 to apply.');
    return;
  }

  console.log('\nApplying changes...');
  await prisma.$transaction(
    async (tx) => {
      // Phase 1: move every row to a collision-free placeholder code, since
      // the target codes overlap with existing codes (employeeCode is
      // @unique and the constraint isn't deferrable). Done as two bulk
      // statements (not per-row round trips) since this runs over a slow
      // SSH tunnel and per-row updates blew past the transaction timeout.
      const placeholderValues = Prisma.join(
        changed.map((p) => Prisma.sql`(${p.id}, ${`MIGTMP-${p.id}`})`),
      );
      await tx.$executeRaw`
        UPDATE "Employee" AS e SET "employeeCode" = v.new_code
        FROM (VALUES ${placeholderValues}) AS v(id, new_code)
        WHERE e.id = v.id
      `;

      const finalValues = Prisma.join(
        changed.map((p) => Prisma.sql`(${p.id}, ${p.newCode})`),
      );
      await tx.$executeRaw`
        UPDATE "Employee" AS e SET "employeeCode" = v.new_code
        FROM (VALUES ${finalValues}) AS v(id, new_code)
        WHERE e.id = v.id
      `;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  console.log(`Done. Renumbered ${changed.length} employee(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
