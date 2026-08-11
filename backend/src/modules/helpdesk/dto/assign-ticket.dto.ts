import { IsUUID } from 'class-validator';

export class AssignTicketDto {
  @IsUUID()
  agentId: string;
}
