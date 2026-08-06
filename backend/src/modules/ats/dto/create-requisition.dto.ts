import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateRequisitionDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsString()
  title: string;

  @IsUUID()
  departmentId: string;

  @IsUUID()
  hiringManagerId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  headcount?: number;

  @IsOptional()
  @IsNumber()
  budgetCtc?: number;
}
