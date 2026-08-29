import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { LearningRequestStatus, Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { RequiresModule } from '../../shared/rbac/requires-module.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { LearningService } from './learning.service';
import { SubmitLearningRequestDto } from './dto/submit-learning-request.dto';
import { LearningDecisionDto } from './dto/learning-decision.dto';
import { SubmitCertificateDto } from './dto/submit-certificate.dto';

@Controller('learning')
@RequiresModule('LEARNING')
export class LearningController {
  constructor(private readonly learningService: LearningService) {}

  @Get('spend-limit/mine')
  getMySpendLimit(@CurrentUser() user: { userId: string }) {
    return this.learningService.getMySpendLimit(user.userId);
  }

  @Get('spend-limit')
  @Roles(Role.SUPER_ADMIN)
  listAllSpendLimits() {
    return this.learningService.listAllSpendLimits();
  }

  @Post('requests')
  submitRequest(
    @Body() dto: SubmitLearningRequestDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.learningService.submitRequest(
      user.userId,
      dto,
      user.role as Role,
    );
  }

  @Get('requests/mine')
  listMine(@CurrentUser() user: { userId: string }) {
    return this.learningService.listMine(user.userId);
  }

  @Get('requests/pending-for-me')
  listPendingForApprover(@CurrentUser() user: { userId: string }) {
    return this.learningService.listPendingForApprover(user.userId);
  }

  @Get('requests/pending-manager-stage')
  @Roles(Role.SUPER_ADMIN)
  listPendingManagerStageForVisibility() {
    return this.learningService.listPendingManagerStageForVisibility();
  }

  @Get('requests/pending-final-approval')
  @Roles(Role.SUPER_ADMIN)
  listPendingFinalApproval() {
    return this.learningService.listPendingFinalApproval();
  }

  @Post('requests/:id/decision')
  decide(
    @Param('id') id: string,
    @Body() dto: LearningDecisionDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.learningService.decide(id, user.userId, dto, user.role as Role);
  }

  @Post('requests/:id/certificate')
  submitCertificate(
    @Param('id') id: string,
    @Body() dto: SubmitCertificateDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.learningService.submitCertificate(
      id,
      user.userId,
      dto.certificateRef,
    );
  }

  @Post('requests/:id/reimburse')
  @Roles(Role.SUPER_ADMIN)
  markReimbursed(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.learningService.markReimbursed(id, user.userId);
  }

  @Get('requests')
  @Roles(Role.SUPER_ADMIN)
  listAll(@Query('status') status?: LearningRequestStatus) {
    return this.learningService.listAll(status);
  }
}
