import { IsUUID } from 'class-validator';

export class IssueAssetDto {
  @IsUUID()
  employeeId: string;
}
