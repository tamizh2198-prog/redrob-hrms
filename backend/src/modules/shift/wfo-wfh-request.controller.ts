import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { RequiresModule } from '../../shared/rbac/requires-module.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { WfoWfhRequestService } from './wfo-wfh-request.service';
import { CreateWfoWfhRequestDto } from './dto/create-wfo-wfh-request.dto';
import { WfoWfhDecisionDto } from './dto/wfo-wfh-decision.dto';
import { AddCommentDto } from '../../shared/request-comments/add-comment.dto';

@Controller('wfo-wfh-requests')
@RequiresModule('SHIFT')
export class WfoWfhRequestController {
  constructor(private readonly wfoWfhRequestService: WfoWfhRequestService) {}

  @Post()
  submit(
    @Body() dto: CreateWfoWfhRequestDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.wfoWfhRequestService.submit(
      user.userId,
      dto,
      user.role as Role,
    );
  }

  @Get('mine')
  listMine(@CurrentUser() user: { userId: string }) {
    return this.wfoWfhRequestService.listMine(user.userId);
  }

  @Get('pending-for-me')
  listPendingForApprover(@CurrentUser() user: { userId: string }) {
    return this.wfoWfhRequestService.listPendingForApprover(user.userId);
  }

  @Get('pending-manager-stage')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  listPendingManagerStageForVisibility() {
    return this.wfoWfhRequestService.listPendingManagerStageForVisibility();
  }

  @Get('pending-final-approval')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  listPendingFinalApproval() {
    return this.wfoWfhRequestService.listPendingFinalApproval();
  }

  @Post(':id/decision')
  decide(
    @Param('id') id: string,
    @Body() dto: WfoWfhDecisionDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.wfoWfhRequestService.decide(
      id,
      user.userId,
      dto,
      user.role as Role,
    );
  }

  @Get()
  @Roles(Role.SUPER_ADMIN)
  listAll(
    @Query('status')
    status?: 'PENDING_MANAGER' | 'PENDING_FINAL_APPROVAL' | 'APPROVED' | 'REJECTED',
  ) {
    return this.wfoWfhRequestService.listAll(status);
  }

  @Post(':id/comments')
  @Roles(Role.SUPER_ADMIN)
  addComment(
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.wfoWfhRequestService.addComment(id, user.userId, dto.body);
  }

  @Get(':id/comments')
  listComments(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.wfoWfhRequestService.listComments(
      id,
      user.userId,
      user.role as Role,
    );
  }
}
