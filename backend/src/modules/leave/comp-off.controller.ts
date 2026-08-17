import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { CompOffService } from './comp-off.service';
import { CreateCompOffRequestDto } from './dto/create-comp-off-request.dto';
import { LeaveDecisionDto } from './dto/leave-decision.dto';
import { AddCommentDto } from '../../shared/request-comments/add-comment.dto';

// No @RequiresModule() here — matches LeaveController's existing
// convention: Leave has no module-grant gating today.
@Controller('comp-off-requests')
export class CompOffController {
  constructor(private readonly compOffService: CompOffService) {}

  @Post()
  submit(
    @Body() dto: CreateCompOffRequestDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.compOffService.submit(user.userId, dto);
  }

  @Get('mine')
  listMine(@CurrentUser() user: { userId: string }) {
    return this.compOffService.listMine(user.userId);
  }

  @Get('pending-for-me')
  listPendingForApprover(@CurrentUser() user: { userId: string }) {
    return this.compOffService.listPendingForApprover(user.userId);
  }

  @Post(':id/decision')
  decide(
    @Param('id') id: string,
    @Body() dto: LeaveDecisionDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.compOffService.decide(id, user.userId, dto, user.role as Role);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN)
  listAll(@Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    return this.compOffService.listAll(status);
  }

  @Post(':id/comments')
  @Roles(Role.SUPER_ADMIN)
  addComment(
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.compOffService.addComment(id, user.userId, dto.body);
  }

  @Get(':id/comments')
  listComments(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.compOffService.listComments(id, user.userId, user.role as Role);
  }
}
