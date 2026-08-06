import { IsObject, IsUUID } from 'class-validator';

export class CreateOfferDto {
  @IsUUID()
  candidateId: string;

  @IsObject()
  ctcBreakup: Record<string, unknown>;
}
