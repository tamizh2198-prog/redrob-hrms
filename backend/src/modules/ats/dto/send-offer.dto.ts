import { IsOptional, IsUUID } from 'class-validator';

export class SendOfferDto {
  // Which letter template to render for this send — omit to use the
  // company's default template (or the built-in fallback copy if none is
  // marked default).
  @IsOptional()
  @IsUUID()
  templateId?: string;
}
