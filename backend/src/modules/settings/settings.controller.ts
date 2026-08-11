import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { SettingsService } from './settings.service';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';
import { CreateOrgUnitDto } from './dto/create-org-unit.dto';
import { UpdateOrgUnitDto } from './dto/update-org-unit.dto';
import { UpdateIntegrationDto } from './dto/update-integration.dto';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('company')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  getCompanySettings() {
    return this.settingsService.getCompanySettings();
  }

  @Patch('company')
  @Roles(Role.SUPER_ADMIN)
  updateCompanySettings(@Body() dto: UpdateCompanySettingsDto) {
    return this.settingsService.updateCompanySettings(dto);
  }

  @Get('org-structure')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
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
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
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
}
