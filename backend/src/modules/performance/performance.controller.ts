import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { PerformanceService } from './performance.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalProgressDto } from './dto/update-goal-progress.dto';
import { OpenReviewCycleDto } from './dto/open-review-cycle.dto';
import { SubmitSelfAssessmentDto } from './dto/submit-self-assessment.dto';
import { SubmitManagerAssessmentDto } from './dto/submit-manager-assessment.dto';
import { CorrectRatingDto } from './dto/correct-rating.dto';
import { SubmitMonthlyEvaluationDto } from './dto/submit-monthly-evaluation.dto';
import { AuditMonthlyEvaluationDto } from './dto/audit-monthly-evaluation.dto';

@Controller('performance')
export class PerformanceController {
  constructor(private readonly performanceService: PerformanceService) {}

  @Post('goals')
  createGoal(
    @Body() dto: CreateGoalDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.performanceService.createGoal(
      dto,
      user.userId,
      user.role as Role,
    );
  }

  @Get('goals')
  listGoals(
    @Query('employeeId') employeeId: string,
    @Query('cycleId') cycleId: string | undefined,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.performanceService.listGoals(employeeId, cycleId, {
      userId: user.userId,
      role: user.role as Role,
    });
  }

  @Patch('goals/:id/progress')
  updateGoalProgress(
    @Param('id') id: string,
    @Body() dto: UpdateGoalProgressDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.performanceService.updateGoalProgress(
      id,
      dto.actual,
      user.userId,
      user.role as Role,
    );
  }

  @Post('reviews/cycle')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  openReviewCycle(@Body() dto: OpenReviewCycleDto) {
    return this.performanceService.openReviewCycle(dto);
  }

  @Get('reviews/cycles')
  listReviewCycles() {
    return this.performanceService.listReviewCycles();
  }

  @Post('reviews/cycle/:id/close')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  closeReviewCycle(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.performanceService.closeReviewCycle(id, user.userId);
  }

  @Get('reviews/cycle/:id/calibration')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  getCalibrationView(@Param('id') id: string) {
    return this.performanceService.getCalibrationView(id);
  }

  @Post('reviews/self-assessment')
  submitSelfAssessment(
    @Body() dto: SubmitSelfAssessmentDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.performanceService.submitSelfAssessment(dto, user.userId);
  }

  @Post('reviews/manager-assessment')
  submitManagerAssessment(
    @Body() dto: SubmitManagerAssessmentDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.performanceService.submitManagerAssessment(
      dto,
      user.userId,
      user.role as Role,
    );
  }

  @Post('reviews/:id/correct-rating')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  correctRating(
    @Param('id') id: string,
    @Body() dto: CorrectRatingDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.performanceService.correctRating(id, dto, user.userId);
  }

  @Get('reviews/:cycleId/:employeeId')
  getReview(
    @Param('cycleId') cycleId: string,
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.performanceService.getReview(cycleId, employeeId, {
      userId: user.userId,
      role: user.role as Role,
    });
  }

  @Post('evaluations')
  submitMonthlyEvaluation(
    @Body() dto: SubmitMonthlyEvaluationDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.performanceService.submitMonthlyEvaluation(dto, user.userId);
  }

  @Get('evaluations')
  listMonthlyEvaluations(
    @Query('employeeId') employeeId: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.performanceService.listMonthlyEvaluations(
      employeeId,
      user.userId,
      user.role as Role,
    );
  }

  @Post('evaluations/:id/audit')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  auditMonthlyEvaluation(
    @Param('id') id: string,
    @Body() dto: AuditMonthlyEvaluationDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.performanceService.auditMonthlyEvaluation(id, dto, user.userId);
  }

  @Get('evaluations/:id')
  getMonthlyEvaluation(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.performanceService.getMonthlyEvaluation(
      id,
      user.userId,
      user.role as Role,
    );
  }
}
