import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { WorkflowService } from './workflow.service';
import { CreateWorkflowDefinitionDto } from './dto/create-workflow-definition.dto';
import { CreateApprovalRequestDto } from './dto/create-approval-request.dto';
import { DecideApprovalDto } from './dto/decide-approval.dto';

@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  // Section 7.15 Primary Users/Roles: "Super Admin/HR Admin — configures
  // workflow definitions."
  @Post('definitions')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  createDefinition(
    @Body() dto: CreateWorkflowDefinitionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.workflowService.createDefinition(dto, user.userId);
  }

  @Get('definitions')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  listDefinitions() {
    return this.workflowService.listDefinitions();
  }

  // "Any module — consumes the engine via a standard API" — open to any
  // authenticated caller, not role-gated.
  @Post('requests')
  createRequest(
    @Body() dto: CreateApprovalRequestDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.workflowService.createRequest(dto, user.userId);
  }

  @Get('my-approvals')
  myApprovals(@CurrentUser() user: { userId: string; role: string }) {
    return this.workflowService.listMyApprovals(user.userId, user.role as Role);
  }

  @Get('requests/:id')
  getRequest(@Param('id') id: string) {
    return this.workflowService.getRequest(id);
  }

  @Post('requests/:id/decide')
  decide(
    @Param('id') id: string,
    @Body() dto: DecideApprovalDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.workflowService.decide(id, dto, user.userId);
  }
}
