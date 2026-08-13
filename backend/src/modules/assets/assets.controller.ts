import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AssetStatus, Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { CreateAssetRequestDto } from './dto/create-asset-request.dto';
import { IssueAssetDto } from './dto/issue-asset.dto';
import { ReturnAssetDto } from './dto/return-asset.dto';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  create(@Body() dto: CreateAssetDto) {
    return this.assetsService.createAsset(dto);
  }

  @Get()
  @Roles(Role.MANAGER, Role.HR_ADMIN, Role.SUPER_ADMIN)
  list(@Query('status') status?: AssetStatus) {
    return this.assetsService.listAssets(status);
  }

  @Get('mine')
  listMine(@CurrentUser() user: { userId: string }) {
    return this.assetsService.getEmployeeAssignments(user.userId);
  }

  @Post('requests')
  createRequest(
    @Body() dto: CreateAssetRequestDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.assetsService.createAssetRequest(dto, user.userId);
  }

  @Get('requests')
  listRequests(
    @Query('employeeId') employeeId: string | undefined,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.assetsService.listAssetRequests(
      { employeeId },
      { userId: user.userId, role: user.role as Role },
    );
  }

  @Post('requests/:id/decision')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  decideRequest(
    @Param('id') id: string,
    @Body('approve') approve: boolean,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.assetsService.decideAssetRequest(
      id,
      approve,
      user.userId,
      user.role as Role,
    );
  }

  @Post(':id/issue')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  issue(@Param('id') id: string, @Body() dto: IssueAssetDto) {
    return this.assetsService.issueAsset(id, dto);
  }

  @Post('assignments/:id/acknowledge')
  acknowledge(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.assetsService.acknowledgeAsset(id, user.userId);
  }

  @Post(':id/return')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  return_(@Param('id') id: string, @Body() dto: ReturnAssetDto) {
    return this.assetsService.returnAsset(id, dto);
  }
}
