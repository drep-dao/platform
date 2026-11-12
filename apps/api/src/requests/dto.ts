import { IsArray, IsBoolean, IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// §R2 — the request kinds the board can shape a form for.
export const REQUEST_KINDS = ['NOTIFICATION', 'CALL', 'PROPOSAL_REVIEW', 'ANSWER'] as const;

export class CreateRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  // §R2 — description is derived from the form fields (first markdown element); kept optional for the
  // dynamic form. The service still rejects a request with no content at all.
  @IsOptional() @IsString() @MaxLength(20000) description?: string;
  @IsOptional() @IsIn(REQUEST_KINDS as unknown as string[]) kind?: string;
  // §R2 — configured form-element values: [{ key, label, type, value }]. Loosely typed on purpose (value
  // is a string or a links array); the service sanitises it. No @ValidateNested so the global whitelist
  // leaves the array contents intact.
  @IsOptional() @IsArray() fields?: unknown[];
  @IsOptional() @IsUUID() typeId?: string;
  @IsOptional() @IsString() @MaxLength(64) feeTxHash?: string;
  @IsOptional() @IsISO8601() expectedResponseAt?: string; // §R — requested response-by time (future)
}

// §R2 — one element of a request form, as the board configures it in the Request formatter.
export class FormElementDto {
  @IsString() @IsNotEmpty() @MaxLength(64) id!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) label!: string;
  @IsIn(['text', 'markdown', 'select', 'links', 'date']) type!: string;
  @IsOptional() @IsIn(['small', 'large']) size?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(120, { each: true }) options?: string[]; // select only
  @IsOptional() @IsBoolean() required?: boolean;
}

// §R2 — board saves the whole element list for one kind.
export class SaveFormConfigDto {
  @IsIn(REQUEST_KINDS as unknown as string[]) kind!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => FormElementDto) elements!: FormElementDto[];
}

export class SubmitRequestFeeDto {
  @IsString() @IsNotEmpty() @MaxLength(64) txHash!: string;
}

export class SetRequestStatusDto {
  @IsIn(['ACTIVE', 'ACCEPTED', 'DONE', 'REJECTED']) status!: string;
}

// §R2 — board attaches/edits a request's result (markdown). Empty clears it.
export class SetRequestResultDto {
  @IsOptional() @IsString() @MaxLength(20000) result?: string;
}

// §R — board links/unlinks an internal proposal (escalation to a vote); null unlinks.
export class SetLinkedProposalDto {
  @IsOptional() @IsUUID() proposalId?: string | null;
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

export class UpdateRequestDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(20000) description?: string;
  @IsOptional() @IsIn(REQUEST_KINDS as unknown as string[]) kind?: string;
  @IsOptional() @IsArray() fields?: unknown[];
  @IsOptional() @IsString() typeId?: string;
  @IsOptional() expectedResponseAt?: string | null;
}

export class PublishRequestDto {
  @IsOptional() @IsString() @MaxLength(64) feeTxHash?: string;
}

export class RequestCommentBodyDto {
  @IsString() @IsNotEmpty() @MaxLength(4000) contentMd!: string;
  @IsOptional() @IsString() parentId?: string;
}
