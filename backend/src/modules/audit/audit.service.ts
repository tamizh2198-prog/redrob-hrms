import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

export interface AuditLogEntry {
  actorId?: string;
  actorRole?: string;
  method: string;
  path: string;
  module: string;
  statusCode?: number;
  requestBody?: unknown;
  responseBody?: unknown;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaultCompany: DefaultCompanyService,
  ) {}

  // Section 7.18 Acceptance Criteria: "no update or delete API exists for
  // audit records, even for Super Admin" — this insert is the only write
  // path; AuditInterceptor is the only caller.
  async record(entry: AuditLogEntry): Promise<void> {
    const companyId = await this.defaultCompany.getOrCreate();
    await this.prisma.auditLog.create({
      data: {
        companyId,
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        method: entry.method,
        path: entry.path,
        module: entry.module,
        statusCode: entry.statusCode,
        requestBody: entry.requestBody as Prisma.InputJsonValue | undefined,
        responseBody: entry.responseBody as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private buildWhere(query: ListAuditLogsQueryDto): Prisma.AuditLogWhereInput {
    return {
      ...(query.module && { module: query.module }),
      ...(query.actorId && { actorId: query.actorId }),
      ...((query.dateFrom || query.dateTo) && {
        createdAt: {
          ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
          ...(query.dateTo && { lte: new Date(query.dateTo) }),
        },
      }),
    };
  }

  async listAuditLogs(query: ListAuditLogsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildWhere(query);

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  // Section 7.18 APIs: "GET /api/v1/audit-logs/export" — same filters, no
  // pagination, capped so an unbounded date range can't blow up memory (a
  // real system would stream this; hand-rolled CSV keeps this build
  // dependency-free, same approach as Analytics' report-export.util.ts).
  async exportAuditLogs(query: ListAuditLogsQueryDto) {
    const rows = await this.prisma.auditLog.findMany({
      where: this.buildWhere(query),
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    return { rows, total: rows.length };
  }
}
