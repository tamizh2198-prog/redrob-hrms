import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from "class-validator";
import { AnnouncementPriority, AnnouncementScope, RecognitionCategory } from "@prisma/client";

export class CreateAnnouncementDto {
  @IsString()
  title: string;

  @IsString()
  body: string;

  @IsEnum(AnnouncementScope)
  scope: AnnouncementScope;

  // Required when scope is DEPARTMENT/LOCATION — validated in the service,
  // not here, since the requirement is conditional on another field.
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsEnum(AnnouncementPriority)
  priority?: AnnouncementPriority;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresAck?: boolean;
}

export class CreateRecognitionDto {
  @IsUUID()
  recipientId: string;

  @IsString()
  message: string;

  @IsEnum(RecognitionCategory)
  category: RecognitionCategory;

  // Recognition can optionally be restricted to a department — omit for
  // public kudos visible to everyone.
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
