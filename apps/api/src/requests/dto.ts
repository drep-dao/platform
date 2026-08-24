import { IsBoolean, IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(20000) description!: string;
  @IsOptional() @IsUUID() typeId?: string;
  @IsOptional() @IsString() @MaxLength(64) feeTxHash?: string;
  @IsOptional() @IsISO8601() expectedResponseAt?: string; // §R — requested response-by time (future)
}

export class SubmitRequestFeeDto {
  @IsString() @IsNotEmpty() @MaxLength(64) txHash!: string;
}

export class SetRequestStatusDto {
  @IsIn(['ACTIVE', 'DONE', 'REJECTED']) status!: string;
}

export class CreateRequestTypeDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @Min(1) priceAda!: number;
}

export class UpdateRequestTypeDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @Min(1) priceAda?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
