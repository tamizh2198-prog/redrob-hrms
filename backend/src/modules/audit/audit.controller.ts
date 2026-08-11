import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { AuditService } from './audit.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import { toCsv } from '../analytics/report-export.util';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  listAuditLogs(@Query() query: ListAuditLogsQueryDto) {
    return this.auditService.listAuditLogs(query);
  }

  @Get('export')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  async exportAuditLogs(@Query() query: ListAuditLogsQueryDto) {
    const { rows } = await this.auditService.exportAuditLogs(query);
    const csv = toCsv({ entity: 'AuditLog', total: rows.length, rows });
    return new StreamableFile(Buffer.from(csv, 'utf-8'), {
      type: 'text/csv',
      disposition: 'attachment; filename="audit-logs.csv"',
    });
  }
}
