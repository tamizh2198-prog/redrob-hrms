import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { RequiresModule } from '../../shared/rbac/requires-module.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { BuildReportDto } from './dto/build-report.dto';
import { CreateSavedReportDto } from './dto/create-saved-report.dto';
import { exportReport } from './report-export.util';

@Controller('analytics')
@RequiresModule('ANALYTICS')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  // Section 7.13 Architecture Decision #2: dashboard type comes from the
  // authenticated user's own role, never a client-supplied parameter —
  // there is deliberately no :role in this path.
  @Get('dashboard')
  getDashboard(@CurrentUser() user: { userId: string; role: string }) {
    return this.analyticsService.getDashboard(user.userId, user.role as Role);
  }

  // Section 7.13 Primary Users/Roles assigns the report builder to HR
  // Admin only ("HR Admin — org-wide reports, report builder").
  @Get('reports/entities')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  listReportEntities() {
    return this.analyticsService.listReportEntities();
  }

  @Post('reports/build')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  async buildReport(@Body() dto: BuildReportDto) {
    const result = await this.analyticsService.buildReport(dto);
    if (!dto.format) return result;

    const { buffer, contentType, extension } = await exportReport(result, dto.format);
    return new StreamableFile(buffer, {
      type: contentType,
      disposition: `attachment; filename="${dto.entity}-report.${extension}"`,
    });
  }

  // Section 7.13 Phase 5: SavedReport is persisted only for scheduled
  // reports — an ad-hoc /reports/build call never creates one.
  @Post('reports/saved')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  createSavedReport(
    @Body() dto: CreateSavedReportDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.analyticsService.createSavedReport(dto, user.userId);
  }

  @Get('reports/saved')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  listSavedReports() {
    return this.analyticsService.listSavedReports();
  }

  @Delete('reports/saved/:id')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  deleteSavedReport(@Param('id') id: string) {
    return this.analyticsService.deleteSavedReport(id);
  }
}
