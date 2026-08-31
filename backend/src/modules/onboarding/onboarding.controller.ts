import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { RequiresModule } from '../../shared/rbac/requires-module.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { Public } from '../../shared/auth/public.decorator';
import { OnboardingService } from './onboarding.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { PreboardSubmitDto } from './dto/preboard-submit.dto';
import { PortalCompleteTaskDto } from './dto/portal-complete-task.dto';
import { InitChecklistDto } from './dto/init-checklist.dto';
import { SubmitProbationFeedbackDto } from './dto/submit-probation-feedback.dto';

@Controller('onboarding')
@RequiresModule('ONBOARDING')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('templates')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.onboardingService.createTemplate(dto);
  }

  @Get('templates')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  listTemplates() {
    return this.onboardingService.listTemplates();
  }

  @Get('checklists')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  listActiveChecklists() {
    return this.onboardingService.listActiveChecklists();
  }

  // Registered here (before ":employeeId/..." below) for the same reason
  // as the "portal/..." routes further down.
  @Get('probation-feedback/mine')
  myProbationFeedback(@CurrentUser() user: { userId: string }) {
    return this.onboardingService.listMyProbationFeedback(user.userId);
  }

  @Post('probation-feedback/:id/submit')
  submitProbationFeedback(
    @Param('id') id: string,
    @Body() dto: SubmitProbationFeedbackDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.onboardingService.submitProbationFeedback(
      id,
      user.userId,
      dto,
    );
  }

  @Get('probation-feedback')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  listProbationFeedback() {
    return this.onboardingService.listProbationFeedback();
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
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  init(
    @Param('employeeId') employeeId: string,
    @Body() dto: InitChecklistDto,
  ) {
    return this.onboardingService.initChecklist(employeeId, dto.templateId);
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
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  activate(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.onboardingService.activateEmployee(employeeId, user.userId);
  }
}
