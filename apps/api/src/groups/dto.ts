import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

// §29 — configurable groups. Forced voting rules (members-only, 1 member = 1 vote, 67% threshold)
// are NOT configurable and are enforced in the service, so they are absent from these DTOs.
export const ADMISSION_TYPES = ['FREE', 'BOARD', 'DREPS', 'SINGLE_DREP', 'ADMIN'];
export const GROUP_PROFILE_FIELDS = ['memberSince', 'displayName', 'photo', 'bio', 'country', 'conflictOfInterest', 'blockchainAddress', 'expertise', 'links', 'preferences'];
export const GROUP_PROPOSAL_TYPES = ['INFORMATIVE', 'POLL', 'INSTRUCTIVE'];
export const GROUP_COMMENTERS = ['members', 'dreps', 'experts', 'submitters', 'viewers'];
export const GROUP_VOTING_TYPES = ['ONE_PERSON_ONE_VOTE', 'DREP_POWER', 'ADJUSTED_POWER'];

/** Sysadmin: create a group (starts HIDDEN — the JSON config always carries the group name). */
export class AdminCreateGroupDto {
  @IsString() @MinLength(2) @MaxLength(40) name!: string;
  @IsString() @MinLength(2) @MaxLength(40) key!: string;
}

/** Sysadmin: reconfigure a group (name, profile fields, proposal types, admission, commenting, status). */
export class AdminUpdateGroupDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(40) name?: string;
  @IsOptional() @IsArray() @IsIn(GROUP_PROFILE_FIELDS, { each: true }) profileFields?: string[];
  @IsOptional() @IsArray() @IsIn(GROUP_PROPOSAL_TYPES, { each: true }) proposalTypes?: string[];
  @IsOptional() @IsIn(ADMISSION_TYPES) admissionType?: string;
  @IsOptional() approverUserId?: string | null; // a DRep's AppUser id (SINGLE_DREP); null clears it
  @IsOptional() @IsArray() @IsIn(GROUP_COMMENTERS, { each: true }) commenters?: string[];
  @IsOptional() @IsIn(GROUP_VOTING_TYPES) votingType?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) thresholdPct?: number;
  @IsOptional() @IsIn(['ACTIVE', 'HIDDEN']) status?: string;
  @IsOptional() @IsBoolean() membersCanApprove?: boolean; // §29 OG self-governance
}

/** A wallet-authenticated user applies to join a group. Fields are stored per the group's profileFields. */
export class RegisterGroupDto {
  @IsOptional() @IsString() @MaxLength(80) displayName?: string;
  @IsOptional() @IsString() @MaxLength(8000) bio?: string;
  @IsOptional() @IsString() photo?: string; // data URL
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsString() @MaxLength(2000) conflictOfInterest?: string;
  @IsOptional() @IsBoolean() noSelfVote?: boolean; // §29 pledge, tied to conflictOfInterest
  @IsOptional() @IsString() @MaxLength(200) address?: string; // Cardano/blockchain address
  @IsOptional() @IsArray() @IsString({ each: true }) subcategoryIds?: string[]; // expertise
  @IsOptional() @IsObject() socials?: Record<string, string>; // { x, telegram, github, email, website }
  @IsOptional() @IsObject() preferences?: Record<string, boolean>; // { contact, notifications }
}

/** A member submits a proposal for the group (only INFORMATIVE / POLL). */
export class SubmitGroupProposalDto {
  @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) contentMd!: string;
  @IsIn(GROUP_PROPOSAL_TYPES) type!: string;
  @IsISO8601() votingEndAt!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMinSize(2) pollOptions?: string[];
  @IsOptional() @IsBoolean() pollMultiple?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) actors?: string[]; // INSTRUCTIVE
  @IsOptional() @IsISO8601() deliveryDate?: string; // INSTRUCTIVE
}

/** Cast/change a vote. INFORMATIVE uses `choice`; POLL uses `options`. */
export class GroupVoteDto {
  @IsOptional() @IsIn(['YES', 'NO', 'ABSTAIN']) choice?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
}

export class GroupCommentDto {
  @IsString() @MinLength(1) @MaxLength(4000) contentMd!: string;
  @IsOptional() @IsString() parentId?: string;
}

/** §29 OG — a member sets the group's voting quorum (self-governed). */
export class GroupVotingSettingsDto {
  @IsIn(['OPEN', 'EXACT', 'MINIMUM']) quorumMode!: string;
  @IsOptional() @IsInt() @Min(1) @Max(100000) quorumCount?: number;
}
