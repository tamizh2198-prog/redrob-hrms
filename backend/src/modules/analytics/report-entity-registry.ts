import { PrismaService } from '../../shared/database/prisma.service';

export interface ReportFilters {
  departmentId?: string;
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
      'status',
      'dateOfJoining',
    ],
    groupableFields: ['departmentId', 'status'],
    fetch: (prisma, f) =>
      prisma.employee.findMany({
        where: {
          ...(f.departmentId && { departmentId: f.departmentId }),
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
        },
      }),
  },

  Attendance: {
    key: 'Attendance',
    label: 'Attendance',
    fields: [
      'employeeId',
      'date',
      'status',
      'checkInTime',
      'checkOutTime',
      'workHours',
    ],
    groupableFields: ['status'],
    fetch: (prisma, f) =>
      prisma.attendanceRecord.findMany({
        where: {
          ...(f.departmentId && { employee: { departmentId: f.departmentId } }),
          ...(f.status && { status: f.status as never }),
          ...((f.dateFrom || f.dateTo) && {
            date: { gte: f.dateFrom, lte: f.dateTo },
          }),
        },
        select: {
          id: true,
          employeeId: true,
          date: true,
          status: true,
          checkInTime: true,
          checkOutTime: true,
          workHours: true,
        },
      }),
  },

  // Date-range filters on start date (an application starting within the
  // window) rather than full-range overlap — the simpler, still-correct
  // reading for "leave taken in this period" reports.
  Leave: {
    key: 'Leave',
    label: 'Leave',
    fields: [
      'employeeId',
      'leaveTypeId',
      'startDate',
      'endDate',
      'daysCount',
      'status',
    ],
    groupableFields: ['status', 'leaveTypeId'],
    fetch: (prisma, f) =>
      prisma.leaveApplication.findMany({
        where: {
          ...(f.departmentId && { employee: { departmentId: f.departmentId } }),
          ...(f.status && { status: f.status as never }),
          ...((f.dateFrom || f.dateTo) && {
            startDate: { gte: f.dateFrom, lte: f.dateTo },
          }),
        },
        select: {
          id: true,
          employeeId: true,
          leaveTypeId: true,
          startDate: true,
          endDate: true,
          daysCount: true,
          status: true,
        },
      }),
  },

  // Maps to Candidate — the row-level record a hiring-pipeline report
  // actually wants (one row per applicant); "status" filters currentStage.
  ATS: {
    key: 'ATS',
    label: 'Recruitment (ATS)',
    fields: ['name', 'email', 'currentStage', 'requisitionId', 'appliedAt'],
    groupableFields: ['currentStage'],
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

  // Asset has no departmentId of its own — department reachability is via
  // whoever it's currently (unreturned) assigned to.
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
    fetch: (prisma, f) =>
      prisma.asset.findMany({
        where: {
          ...(f.departmentId && {
            assignments: {
              some: {
                employee: { departmentId: f.departmentId },
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
