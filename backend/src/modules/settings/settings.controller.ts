import { Body, Controller, Get, Param, Patch, Post, StreamableFile } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { SettingsService } from './settings.service';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';
import { CreateOrgUnitDto } from './dto/create-org-unit.dto';
import { UpdateOrgUnitDto } from './dto/update-org-unit.dto';
import { UpdateIntegrationDto } from './dto/update-integration.dto';
import { ConfirmPilotDataResetDto } from './dto/confirm-pilot-data-reset.dto';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('company')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  getCompanySettings() {
    return this.settingsService.getCompanySettings();
  }

  @Patch('company')
  @Roles(Role.SUPER_ADMIN)
  updateCompanySettings(@Body() dto: UpdateCompanySettingsDto) {
    return this.settingsService.updateCompanySettings(dto);
  }

  @Get('org-structure')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  listOrgStructure() {
    return this.settingsService.listOrgStructure();
  }

  @Post('org-structure/:type')
  @Roles(Role.SUPER_ADMIN)
  createOrgUnit(@Param('type') type: string, @Body() dto: CreateOrgUnitDto) {
    return this.settingsService.createOrgUnit(type, dto);
  }

  @Patch('org-structure/:type/:id')
  @Roles(Role.SUPER_ADMIN)
  updateOrgUnit(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrgUnitDto,
  ) {
    return this.settingsService.updateOrgUnit(type, id, dto);
  }

  @Get('integrations')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  listIntegrations() {
    return this.settingsService.listIntegrations();
  }

  @Patch('integrations/:type')
  @Roles(Role.SUPER_ADMIN)
  updateIntegration(
    @Param('type') type: string,
    @Body() dto: UpdateIntegrationDto,
  ) {
    return this.settingsService.updateIntegration(type, dto);
  }

  // Basic pilot-launch backup: streams a full JSON export of every table
  // straight to the caller's browser as a download — no persistent storage
  // on the server, so there's nothing here that survives a redeploy/restart
  // to accidentally leak. Super Admin only: the file contains passwordHash
  // and other sensitive fields intact, by design (see exportBackup()).
  // Pilot-launch reset, step 1 of 2: read-only. Reports exactly what a
  // reset would remove/keep, with no deletion — see
  // SettingsService.previewPilotDataReset for the KEEP-list rationale and
  // the models flagged as judgment calls. The actual delete endpoint is a
  // deliberately separate, more heavily gated step, not built here.
  @Get('pilot-data-reset/preview')
  @Roles(Role.SUPER_ADMIN)
  previewPilotDataReset() {
    return this.settingsService.previewPilotDataReset();
  }

  // Step 2 of 2 — the actual deletion. Requires the exact confirmation
  // phrase in the body (see SettingsService.RESET_CONFIRMATION_PHRASE);
  // anything else is rejected before touching the database. Irreversible —
  // download a backup (GET /settings/backup) first.
  @Post('pilot-data-reset/apply')
  @Roles(Role.SUPER_ADMIN)
  applyPilotDataReset(@Body() dto: ConfirmPilotDataResetDto) {
    return this.settingsService.applyPilotDataReset(dto.confirmationPhrase);
  }

  @Get('backup')
  @Roles(Role.SUPER_ADMIN)
  async downloadBackup() {
    const backup = await this.settingsService.exportBackup();
    const buffer = Buffer.from(JSON.stringify(backup), 'utf-8');
    const timestamp = backup.createdAt.replace(/[:.]/g, '-');
    return new StreamableFile(buffer, {
      type: 'application/json',
      disposition: `attachment; filename="redrob-hrms-backup-${timestamp}.json"`,
    });
  }
}
