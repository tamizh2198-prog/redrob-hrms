import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { RequiresModule } from '../../shared/rbac/requires-module.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { Public } from '../../shared/auth/public.decorator';
import { AtsService } from './ats.service';
import { CreateRequisitionDto } from './dto/create-requisition.dto';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { MoveStageDto } from './dto/move-stage.dto';
import { ScheduleInterviewDto } from './dto/schedule-interview.dto';
import { SubmitScorecardDto } from './dto/submit-scorecard.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { RespondOfferDto } from './dto/respond-offer.dto';
import { CreateOfferTemplateDto } from './dto/create-offer-template.dto';
import { UpdateOfferTemplateDto } from './dto/update-offer-template.dto';
import { SendOfferDto } from './dto/send-offer.dto';

@Controller('ats')
@RequiresModule('ATS')
export class AtsController {
  constructor(private readonly atsService: AtsService) {}

  @Post('requisitions')
  @Roles(Role.MANAGER, Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  createRequisition(
    @Body() dto: CreateRequisitionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.atsService.createRequisition(dto, user.userId);
  }

  @Get('requisitions')
  @Roles(Role.MANAGER, Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  listRequisitions(@CurrentUser() user: { userId: string; role: string }) {
    return this.atsService.listRequisitions(user.userId, user.role as Role);
  }

  @Get('requisitions/:id/analytics')
  getAnalytics(@Param('id') id: string) {
    return this.atsService.getPipelineAnalytics(id);
  }

  @Post('requisitions/:id/approve')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  approveRequisition(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.atsService.approveRequisition(id, user.userId);
  }

  @Post('requisitions/:id/publish')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  publishRequisition(@Param('id') id: string) {
    return this.atsService.publishRequisition(id);
  }

  @Public()
  @Post('candidates')
  createCandidate(@Body() dto: CreateCandidateDto) {
    return this.atsService.createCandidate(dto);
  }

  @Get('candidates')
  @Roles(Role.MANAGER, Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  listCandidates(
    @Query('requisitionId') requisitionId: string | undefined,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.atsService.listCandidates(
      requisitionId,
      user.userId,
      user.role as Role,
    );
  }

  @Patch('candidates/:id/stage')
  @Roles(Role.MANAGER, Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  moveStage(
    @Param('id') id: string,
    @Body() dto: MoveStageDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.atsService.moveStage(
      id,
      dto.stage,
      user.userId,
      user.role as Role,
    );
  }

  @Post('candidates/:id/interviews')
  @Roles(Role.MANAGER, Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  scheduleInterview(
    @Param('id') id: string,
    @Body() dto: ScheduleInterviewDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.atsService.scheduleInterview(
      id,
      dto,
      user.userId,
      user.role as Role,
    );
  }

  @Post('interviews/:id/scorecard')
  submitScorecard(
    @Param('id') id: string,
    @Body() dto: SubmitScorecardDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.atsService.submitScorecard(
      id,
      dto,
      user.userId,
      user.role as Role,
    );
  }

  @Post('offers')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  createOffer(@Body() dto: CreateOfferDto) {
    return this.atsService.createOffer(dto);
  }

  @Post('offer-templates')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  createOfferTemplate(@Body() dto: CreateOfferTemplateDto) {
    return this.atsService.createOfferTemplate(dto);
  }

  @Get('offer-templates')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  listOfferTemplates() {
    return this.atsService.listOfferTemplates();
  }

  @Patch('offer-templates/:id')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  updateOfferTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateOfferTemplateDto,
  ) {
    return this.atsService.updateOfferTemplate(id, dto);
  }

  @Delete('offer-templates/:id')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  deleteOfferTemplate(@Param('id') id: string) {
    return this.atsService.deleteOfferTemplate(id);
  }

  // Offer approval is HR Admin/Super Admin only — a Manager (even the
  // requisition's own hiring manager) has no sign-off role here. Enforced
  // in the service; this decorator just matches at the controller for
  // defense-in-depth.
  @Post('offers/:id/approve')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  approveOffer(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.atsService.approveOffer(id, user.userId, user.role as Role);
  }

  @Post('offers/:id/send')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  sendOffer(@Param('id') id: string, @Body() dto: SendOfferDto) {
    return this.atsService.sendOffer(id, dto.templateId);
  }

  @Public()
  @Get('offers/portal')
  getOfferPortal(@Query('token') token: string) {
    return this.atsService.getOfferByToken(token);
  }

  @Public()
  @Post('offers/respond')
  respondOffer(@Body() dto: RespondOfferDto) {
    return this.atsService.respondOffer(dto.token, dto.decision);
  }
}
