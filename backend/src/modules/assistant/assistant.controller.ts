import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { AssistantService } from './assistant.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ConfirmActionDto } from './dto/confirm-action.dto';
import { UploadPolicyDocumentDto } from './dto/upload-policy-document.dto';

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  // Section 7.14 AC: "never returns data outside the requesting user's RBAC
  // scope" — actorId/role always come from the JWT, never the request body.
  @Post('message')
  sendMessage(
    @Body() dto: SendMessageDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.assistantService.sendMessage(
      user.userId,
      user.role as Role,
      dto,
    );
  }

  @Post('action/confirm')
  confirmAction(
    @Body() dto: ConfirmActionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.assistantService.confirmAction(user.userId, dto);
  }

  @Post('policy/upload')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  uploadPolicyDocument(
    @Body() dto: UploadPolicyDocumentDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.assistantService.uploadPolicyDocument(dto, user.userId);
  }

  @Get('conversations/:id/messages')
  listConversationMessages(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.assistantService.listConversationMessages(user.userId, id);
  }
}
