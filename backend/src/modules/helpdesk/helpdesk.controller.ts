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
import { RequiresModule } from '../../shared/rbac/requires-module.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { HelpdeskService } from './helpdesk.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { AddMessageDto } from './dto/add-message.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { CreateFaqDto } from './dto/create-faq.dto';
import { SearchFaqQueryDto } from './dto/search-faq-query.dto';
import { UpsertSlaPolicyDto } from './dto/upsert-sla-policy.dto';

@Controller('helpdesk')
@RequiresModule('HELPDESK')
export class HelpdeskController {
  constructor(private readonly helpdeskService: HelpdeskService) {}

  @Post('tickets')
  createTicket(
    @Body() dto: CreateTicketDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.helpdeskService.createTicket(dto, user.userId);
  }

  @Get('tickets')
  listTickets(
    @Query() query: ListTicketsQueryDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.helpdeskService.listTickets(
      query,
      user.userId,
      user.role as Role,
    );
  }

  @Get('tickets/:id')
  getTicket(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.helpdeskService.getTicket(id, user.userId, user.role as Role);
  }

  @Post('tickets/:id/message')
  addMessage(
    @Param('id') id: string,
    @Body() dto: AddMessageDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.helpdeskService.addMessage(
      id,
      dto,
      user.userId,
      user.role as Role,
    );
  }

  @Post('tickets/:id/assign')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  assignTicket(
    @Param('id') id: string,
    @Body() dto: AssignTicketDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.helpdeskService.assignTicket(id, dto, user.userId);
  }

  @Patch('tickets/:id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.helpdeskService.updateStatus(
      id,
      dto,
      user.userId,
      user.role as Role,
    );
  }

  @Get('faq')
  searchFaq(@Query() query: SearchFaqQueryDto) {
    return this.helpdeskService.searchFaq(query);
  }

  @Post('faq')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  createFaq(@Body() dto: CreateFaqDto) {
    return this.helpdeskService.createFaq(dto);
  }

  @Get('sla-policies')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  listSlaPolicies() {
    return this.helpdeskService.listSlaPolicies();
  }

  @Post('sla-policies')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  upsertSlaPolicy(@Body() dto: UpsertSlaPolicyDto) {
    return this.helpdeskService.upsertSlaPolicy(dto);
  }

  @Get('dashboard')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  getDashboardSummary() {
    return this.helpdeskService.getDashboardSummary();
  }
}
