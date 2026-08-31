import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, ReportSchedule, Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { REPORT_ENTITIES, type ReportRow } from './report-entity-registry';
import { BuildReportDto } from './dto/build-report.dto';
import { CreateSavedReportDto } from './dto/create-saved-report.dto';
import { getReportingHierarchyIds } from '../../shared/employee/reporting-hierarchy.util';

const SCHEDULE_INTERVAL_MS: Record<ReportSchedule, number> = {
  DAILY: 24 * 60 * 60 * 1000,
  WEEKLY: 7 * 24 * 60 * 60 * 1000,
  MONTHLY: 30 * 24 * 60 * 60 * 1000,
};

// Section 7.13 Architecture Decision: "Determine dashboard type from the
// authenticated user's role" — never a user-controlled parameter. Mapping:
//   EMPLOYEE     -> Employee dashboard (self-scoped)
//   MANAGER      -> Manager dashboard (own reporting hierarchy only)
//   HR_ADMIN     -> HR Admin dashboard (org-wide)
//   SUPER_ADMIN  -> Leadership / Executive dashboard (org-wide rollup)
// There is no dedicated "Leadership" role in the Role enum (Section 6 only
// defines EMPLOYEE/MANAGER/HR_ADMIN/SUPER_ADMIN) — SUPER_ADMIN is the
// mapping target, same as HR_ADMIN/SUPER_ADMIN already stand in for the
// PRD's "Support Agent" concept in Helpdesk (Section 7.11).

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(actorId: string, actorRole?: Role) {
    switch (actorRole) {
      case Role.EMPLOYEE:
        return this.getEmployeeDashboard(actorId);
      case Role.MANAGER:
        return this.getManagerDashboard(actorId);
      case Role.HR_ADMIN:
      case Role.HR_ASSOCIATE:
        return this.getHrAdminDashboard(actorId);
      case Role.SUPER_ADMIN:
        return this.getLeadershipDashboard(actorId);
      default:
        throw new ForbiddenException('No dashboard is defined for this role');
    }
  }

  // Section 7.13 Key Feature: "Employee (my pending tasks, my payslip)."
  // Payslip is omitted — no Payroll module exists yet in this codebase to
  // source it from; inventing one would violate "do not invent metrics not
  // explicitly supported by existing data."
  private async getEmployeeDashboard(employeeId: string) {
    const myOpenTickets = await this.prisma.ticket.count({
      where: { employeeId, status: { notIn: ['RESOLVED', 'CLOSED'] } },
    });

    return {
      role: 'EMPLOYEE',
      myOpenTickets,
    };
  }

  // Section 7.13 Business Rule: "a Manager's dashboard can never show data
  // outside their reporting hierarchy" — every widget below is scoped to
  // getReportingHierarchyIds(), not company-wide.
  private async getManagerDashboard(managerId: string) {
    const teamIds = await getReportingHierarchyIds(this.prisma, managerId);

    // `in: []` for an empty teamIds simply matches no rows — no special
    // casing needed for a manager with no reports.
    const [teamGoals, teamMembers] = await Promise.all([
      this.prisma.goal.findMany({ where: { employeeId: { in: teamIds } } }),
      // "My Team" roster — direct + indirect reports (teamIds is the same
      // full downward tree teamSize/teamGoals already scope to), so a
      // manager sees everyone under them, not just direct reports.
      this.prisma.employee.findMany({
        where: { id: { in: teamIds } },
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          status: true,
          photoUrl: true,
          designation: { select: { name: true } },
          department: { select: { name: true } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
    ]);

    const avgGoalProgress =
      teamGoals.length === 0
        ? null
        : Math.round(
            (teamGoals.reduce(
              (sum, g) => sum + (g.target ? g.actual / g.target : 0),
              0,
            ) /
              teamGoals.length) *
              100,
          );

    return {
      role: 'MANAGER',
      teamSize: teamIds.length,
      teamGoalProgressPercent: avgGoalProgress,
      teamMembers: teamMembers.map((m) => ({
        id: m.id,
        employeeCode: m.employeeCode,
        firstName: m.firstName,
        lastName: m.lastName,
        status: m.status,
        photoUrl: m.photoUrl,
        designation: m.designation?.name ?? null,
        department: m.department?.name ?? null,
      })),
    };
  }

  // Section 7.13 Key Feature: "HR Admin (headcount, attrition, hiring
  // funnel)." Org-wide, scoped to the actor's own company.
  private async getHrAdminDashboard(actorId: string) {
    const actor = await this.prisma.employee.findUnique({
      where: { id: actorId },
    });
    const companyId = actor?.companyId;

    const [headcountByStatus, attritionCount, candidatesByStage, openRequisitions] =
      await Promise.all([
        this.prisma.employee.groupBy({
          by: ['status'],
          where: { companyId },
          _count: true,
        }),
        this.prisma.resignation.count({
          where: {
            employee: { companyId },
            submittedDate: { gte: daysAgo(90) },
          },
        }),
        this.prisma.candidate.groupBy({
          by: ['currentStage'],
          where: { requisition: { companyId } },
          _count: true,
        }),
        this.prisma.jobRequisition.count({
          where: { companyId, status: 'PUBLISHED' },
        }),
      ]);

    return {
      role: 'HR_ADMIN',
      headcountByStatus: headcountByStatus.map((h) => ({
        status: h.status,
        count: h._count,
      })),
      attritionLast90Days: attritionCount,
      hiringFunnel: candidatesByStage.map((c) => ({
        stage: c.currentStage,
        count: c._count,
      })),
      openRequisitions,
    };
  }

  // "Leadership sees executive summary across all of the above" (Section
  // 7.13 User Story) — the same org-wide rollup HR Admin sees, not a
  // separate metric set the PRD never defines.
  private async getLeadershipDashboard(actorId: string) {
    const dashboard = await this.getHrAdminDashboard(actorId);
    return { ...dashboard, role: 'SUPER_ADMIN' };
  }

  // Metadata for the frontend to populate the entity/field/group-by
  // pickers without hardcoding the whitelist client-side.
  listReportEntities() {
    return Object.values(REPORT_ENTITIES).map((e) => ({
      key: e.key,
      label: e.label,
      fields: e.fields,
      groupableFields: e.groupableFields,
      statusOptions: e.statusOptions,
    }));
  }

  // Section 7.13 Key Feature: "select entity, choose fields, apply filters
  // (department/date range/status), group-by." Every row keeps its `id`
  // regardless of requested fields, satisfying "reference IDs for
  // drill-down" (Architecture Decision #7/#8).
  async buildReport(dto: BuildReportDto) {
    const entityDef = REPORT_ENTITIES[dto.entity];
    if (!entityDef) {
      throw new BadRequestException(
        `Unknown report entity "${dto.entity}". Available: ${Object.keys(REPORT_ENTITIES).join(', ')}`,
      );
    }

    const rows = await entityDef.fetch(this.prisma, {
      departmentId: dto.departmentId,
      locationId: dto.locationId,
      dateFrom: dto.dateFrom ? new Date(dto.dateFrom) : undefined,
      dateTo: dto.dateTo ? new Date(dto.dateTo) : undefined,
      status: dto.status,
    });

    const outputFields = dto.fields?.length
      ? dto.fields.filter((f) => entityDef.fields.includes(f))
      : entityDef.fields;
    const projected = rows.map((r) => this.project(r, outputFields));

    const result: {
      entity: string;
      total: number;
      rows: ReportRow[];
      groups?: Array<{ key: string; count: number; recordIds: string[] }>;
    } = { entity: dto.entity, total: projected.length, rows: projected };

    if (dto.groupBy && entityDef.groupableFields.includes(dto.groupBy)) {
      result.groups = this.groupRows(rows, dto.groupBy);
    }

    return result;
  }

  private project(row: ReportRow, fields: string[]): ReportRow {
    const out: ReportRow = { id: row.id };
    for (const f of fields) out[f] = row[f];
    return out;
  }

  private groupRows(rows: ReportRow[], groupByField: string) {
    const byKey = new Map<string, string[]>();
    for (const row of rows) {
      // Every groupableFields entry in the registry is a string/enum column
      // (status, departmentId, category, ...) — never an object or Date.
      const raw = row[groupByField];
      const key = typeof raw === 'string' ? raw : 'null';
      const ids = byKey.get(key) ?? [];
      ids.push(row.id);
      byKey.set(key, ids);
    }
    return Array.from(byKey.entries()).map(([key, recordIds]) => ({
      key,
      count: recordIds.length,
      recordIds,
    }));
  }

  // Section 7.13 Phase 5: SavedReport persists ONLY for scheduled reports —
  // there is deliberately no "save" path for an ad-hoc report-builder run.
  async createSavedReport(dto: CreateSavedReportDto, actorId: string) {
    return this.prisma.savedReport.create({
      data: {
        name: dto.name,
        config: dto.config as unknown as Prisma.InputJsonValue,
        schedule: dto.schedule,
        recipientIds: dto.recipientIds,
        createdById: actorId,
      },
    });
  }

  listSavedReports() {
    return this.prisma.savedReport.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async deleteSavedReport(id: string) {
    await this.prisma.savedReport.delete({ where: { id } });
  }

  private isDue(report: {
    schedule: ReportSchedule;
    lastRunAt: Date | null;
  }): boolean {
    if (!report.lastRunAt) return true;
    return (
      Date.now() - report.lastRunAt.getTime() >=
      SCHEDULE_INTERVAL_MS[report.schedule]
    );
  }

  // AC-3: recipients are re-validated against their CURRENT role here, at
  // send time — a recipient who has since left or been demoted below
  // HR_ADMIN/SUPER_ADMIN (the same bar the report-builder endpoints enforce)
  // is silently dropped rather than trusted from when the schedule was created.
  async findDueScheduledReports(): Promise<
    Array<{
      savedReportId: string;
      name: string;
      total: number;
      recipientCount: number;
      validRecipientIds: string[];
    }>
  > {
    const candidates = await this.prisma.savedReport.findMany();
    const due = candidates.filter((r) => this.isDue(r));

    const output: Array<{
      savedReportId: string;
      name: string;
      total: number;
      recipientCount: number;
      validRecipientIds: string[];
    }> = [];

    for (const report of due) {
      const config = report.config as unknown as BuildReportDto;
      const result = await this.buildReport(config);

      const recipientIds = report.recipientIds as string[];
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: recipientIds } },
        select: { id: true, role: true },
      });
      const validRecipientIds = employees
        .filter((e) => e.role === Role.HR_ADMIN || e.role === Role.SUPER_ADMIN)
        .map((e) => e.id);

      await this.prisma.savedReport.update({
        where: { id: report.id },
        data: { lastRunAt: new Date() },
      });

      output.push({
        savedReportId: report.id,
        name: report.name,
        total: result.total,
        recipientCount: recipientIds.length,
        validRecipientIds,
      });
    }

    return output;
  }
}
