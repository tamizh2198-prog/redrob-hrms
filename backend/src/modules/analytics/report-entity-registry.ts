import { PrismaService } from '../../shared/database/prisma.service';

export interface ReportFilters {
  departmentId?: string;
  locationId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  status?: string;
}

export type ReportRow = { id: string } & Record<string, unknown>;

export interface ReportEntityDef {
  key: string;
  label: string;
  // Every field a caller may request in the output; "id" is always
  // included regardless, since drill-down depends on it.
  fields: string[];
  groupableFields: string[];
  // Valid values for the shared "Status" filter dropdown when this entity
  // is selected — each entity maps "status" to a different underlying enum
  // (EmployeeStatus, CandidateStage, AssetStatus), so the frontend can't use
  // one fixed list.
  statusOptions: string[];
  fetch(prisma: PrismaService, filters: ReportFilters): Promise<ReportRow[]>;
}

// Section 7.13 Architecture Decision #6: a whitelisted entity registry,
// structured so Performance/Offboarding/Helpdesk can be added later without
// redesigning the shape — each entry owns its own department/date/status
// reachability, since that differs per entity (Employee has departmentId
// directly; Assets only reaches it through an active AssetAssignment).
export const REPORT_ENTITIES: Record<string, ReportEntityDef> = {
  Employee: {
    key: 'Employee',
    label: 'Employee',
    fields: [
      'employeeCode',
      'firstName',
      'lastName',
      'departmentId',
      'location',
      'status',
      'dateOfJoining',
    ],
    groupableFields: ['departmentId', 'status'],
    statusOptions: [
      'INVITED',
      'PREBOARDING',
      'ACTIVE',
      'ACTIVE_PROBATION',
      'ON_LEAVE',
      'INACTIVE',
      'TERMINATED',
      'ARCHIVED',
    ],
    fetch: async (prisma, f) => {
      const rows = await prisma.employee.findMany({
        where: {
          ...(f.departmentId && { departmentId: f.departmentId }),
          ...(f.locationId && { locationId: f.locationId }),
          ...(f.status && { status: f.status as never }),
          ...((f.dateFrom || f.dateTo) && {
            dateOfJoining: { gte: f.dateFrom, lte: f.dateTo },
          }),
        },
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          departmentId: true,
          status: true,
          dateOfJoining: true,
          location: { select: { name: true } },
        },
      });
      // Flattened to a plain string so the generic report table (which
      // just String()s every cell) doesn't render "[object Object]".
      return rows.map(({ location, ...rest }) => ({
        ...rest,
        location: location?.name ?? null,
      }));
    },
  },

  // Maps to Candidate — the row-level record a hiring-pipeline report
  // actually wants (one row per applicant); "status" filters currentStage.
  // No location filter: JobRequisition only carries departmentId, no
  // locationId, so there's no reachable location dimension here.
  ATS: {
    key: 'ATS',
    label: 'Recruitment (ATS)',
    fields: ['name', 'email', 'currentStage', 'requisitionId', 'appliedAt'],
    groupableFields: ['currentStage'],
    statusOptions: [
      'APPLIED',
      'SCREENING',
      'INTERVIEW',
      'OFFER',
      'HIRED',
      'REJECTED',
    ],
    fetch: (prisma, f) =>
      prisma.candidate.findMany({
        where: {
          ...(f.departmentId && {
            requisition: { departmentId: f.departmentId },
          }),
          ...(f.status && { currentStage: f.status as never }),
          ...((f.dateFrom || f.dateTo) && {
            appliedAt: { gte: f.dateFrom, lte: f.dateTo },
          }),
        },
        select: {
          id: true,
          name: true,
          email: true,
          currentStage: true,
          requisitionId: true,
          appliedAt: true,
        },
      }),
  },

  // Asset has no departmentId/locationId of its own — both are only
  // reachable via whoever it's currently (unreturned) assigned to.
  Assets: {
    key: 'Assets',
    label: 'Assets',
    fields: [
      'category',
      'make',
      'model',
      'serialNumber',
      'status',
      'purchaseDate',
    ],
    groupableFields: ['status', 'category'],
    statusOptions: ['AVAILABLE', 'PENDING_HANDOVER', 'ISSUED', 'IN_REPAIR', 'RETIRED'],
    fetch: (prisma, f) =>
      prisma.asset.findMany({
        where: {
          ...((f.departmentId || f.locationId) && {
            assignments: {
              some: {
                employee: {
                  ...(f.departmentId && { departmentId: f.departmentId }),
                  ...(f.locationId && { locationId: f.locationId }),
                },
                returnedAt: null,
              },
            },
          }),
          ...(f.status && { status: f.status as never }),
          ...((f.dateFrom || f.dateTo) && {
            purchaseDate: { gte: f.dateFrom, lte: f.dateTo },
          }),
        },
        select: {
          id: true,
          category: true,
          make: true,
          model: true,
          serialNumber: true,
          status: true,
          purchaseDate: true,
        },
      }),
  },
};
