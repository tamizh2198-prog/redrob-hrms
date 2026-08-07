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
    @Query('cycleId') cycleId?: string,
  ) {
    return this.performanceService.listGoals(employeeId, cycleId);
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
  ) {
    return this.performanceService.getReview(cycleId, employeeId);
  }
}
