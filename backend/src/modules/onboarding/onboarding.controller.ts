import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { Public } from '../../shared/auth/public.decorator';
import { OnboardingService } from './onboarding.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { PreboardSubmitDto } from './dto/preboard-submit.dto';
import { PortalCompleteTaskDto } from './dto/portal-complete-task.dto';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('templates')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.onboardingService.createTemplate(dto);
  }

  @Get('templates')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  listTemplates() {
    return this.onboardingService.listTemplates();
  }

  @Get('checklists')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  listActiveChecklists() {
    return this.onboardingService.listActiveChecklists();
  }

  // Literal "portal/..." routes must be registered before the ":employeeId/..."
  // routes below, or Nest would match "portal" itself as an employeeId.
  @Public()
  @Get('portal/progress')
  portalProgress(@Query('token') token: string) {
    return this.onboardingService.getProgressViaPortal(token);
  }

  @Public()
  @Post('portal/tasks/:id/complete')
  completeTaskViaPortal(
    @Param('id') id: string,
    @Body() dto: PortalCompleteTaskDto,
  ) {
    return this.onboardingService.completeTaskViaPortal(id, dto.token);
  }

  @Public()
  @Post('preboard/submit')
  submitPreboarding(@Body() dto: PreboardSubmitDto) {
    return this.onboardingService.submitPreboarding(
      dto.token,
      dto.fieldType,
      dto.valueRef,
    );
  }

  @Post('tasks/:id/complete')
  completeTask(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.onboardingService.completeTask(
      id,
      user.userId,
      user.role as Role,
    );
  }

  @Post(':employeeId/init')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  init(@Param('employeeId') employeeId: string) {
    return this.onboardingService.initChecklist(employeeId);
  }

  @Get(':employeeId/progress')
  progress(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.onboardingService.getProgress(employeeId, {
      userId: user.userId,
      role: user.role as Role,
    });
  }

  @Post(':employeeId/activate')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  activate(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.onboardingService.activateEmployee(employeeId, user.userId);
  }
}
