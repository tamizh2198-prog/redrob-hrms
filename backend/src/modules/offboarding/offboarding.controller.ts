import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { RequiresModule } from '../../shared/rbac/requires-module.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { OffboardingService } from './offboarding.service';
import { SubmitResignationDto } from './dto/submit-resignation.dto';
import { AdjustLwdDto } from './dto/adjust-lwd.dto';
import { SignoffClearanceDto } from './dto/signoff-clearance.dto';
import { SubmitExitInterviewDto } from './dto/submit-exit-interview.dto';
import { ComputeSettlementDto } from './dto/compute-settlement.dto';
import { MarkSettlementPaidDto } from './dto/mark-settlement-paid.dto';
import { GenerateLettersDto } from './dto/generate-letters.dto';

@Controller('offboarding')
@RequiresModule('OFFBOARDING')
export class OffboardingController {
  constructor(private readonly offboardingService: OffboardingService) {}

  @Post('resign')
  submitResignation(
    @Body() dto: SubmitResignationDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.offboardingService.submitResignation(
      dto,
      user.userId,
      user.role as Role,
    );
  }

  @Get()
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  list() {
    return this.offboardingService.listResignations();
  }

  // Not HR-only — the checklist's EMPLOYEE_DECLARATION items are signed off
  // by the exiting employee themselves; LEAD_VERIFICATION items by their
  // manager. RBAC per item category is enforced in the service.
  @Post('clearance/:itemId/signoff')
  signoffClearance(
    @Param('itemId') itemId: string,
    @Body() dto: SignoffClearanceDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.offboardingService.signoffClearance(
      itemId,
      dto,
      user.userId,
      user.role as Role,
    );
  }

  @Get(':id')
  getResignation(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.offboardingService.getResignation(id, {
      userId: user.userId,
      role: user.role as Role,
    });
  }

  @Post(':id/adjust-lwd')
  adjustLwd(
    @Param('id') id: string,
    @Body() dto: AdjustLwdDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.offboardingService.adjustLwd(
      id,
      dto,
      user.userId,
      user.role as Role,
    );
  }

  @Get(':id/clearance')
  getClearanceStatus(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.offboardingService.getClearanceStatus(id, {
      userId: user.userId,
      role: user.role as Role,
    });
  }

  @Post(':id/exit-interview')
  submitExitInterview(
    @Param('id') id: string,
    @Body() dto: SubmitExitInterviewDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.offboardingService.submitExitInterview(
      id,
      dto,
      user.userId,
      user.role as Role,
    );
  }

  @Get(':id/settlement')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  computeSettlement(
    @Param('id') id: string,
    @Query() dto: ComputeSettlementDto,
  ) {
    return this.offboardingService.computeSettlement(id, dto);
  }

  @Post(':id/settlement/approve')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  approveSettlement(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.offboardingService.approveSettlement(id, user.userId);
  }

  @Post(':id/settlement/mark-paid')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  markSettlementPaid(
    @Param('id') id: string,
    @Body() dto: MarkSettlementPaidDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.offboardingService.markSettlementPaid(id, dto, user.userId);
  }

  @Post(':id/generate-letters')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  generateLetters(
    @Param('id') id: string,
    @Body() dto: GenerateLettersDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.offboardingService.generateLetters(id, dto, user.userId);
  }
}
