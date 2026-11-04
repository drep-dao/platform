import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateUploadDto {
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  // data:<mime>;base64,<…> — capped by the route body limit + a server-side byte check.
  @IsString() @MinLength(16) @MaxLength(12_000_000) dataUrl!: string;
  @IsOptional() @IsString() @MaxLength(300) fileName?: string;
}

export class CreateLinkDto {
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsString() @MaxLength(2000) url!: string;
}

export class UpdateAiDto {
  // Empty string clears the key. Omitted = unchanged.
  @IsOptional() @IsString() @MaxLength(400) apiKey?: string;
  @IsOptional() @IsString() @MaxLength(80) model?: string;
  // OpenAI-compatible chat-completions base URL (empty resets to OpenAI).
  @IsOptional() @IsString() @MaxLength(300) baseUrl?: string;
  // Output token budget per scoring call (raise for reasoning models).
  @IsOptional() @IsInt() @Min(256) @Max(200000) maxTokens?: number;
  // Sampling temperature 0–2 (low = consistent, best for scoring).
  @IsOptional() @IsNumber() @Min(0) @Max(2) temperature?: number;
  // The scoring prompt (placeholders #PROPOSAL / #TEMPLATE_RULES / #FRAMEWORK_QUESTIONS / #EXTERNAL_LINKS / #GITHUB_LINKS).
  // The three dimension prompts (template coverage, Triangle Forces, Cardano Vision 2030).
  @IsOptional() @IsString() @MaxLength(20_000) templatePrompt?: string;
  @IsOptional() @IsString() @MaxLength(20_000) frameworkPrompt?: string;
  @IsOptional() @IsString() @MaxLength(20_000) visionPrompt?: string;
  // The review framework (areas → questions, outcomes, guidance). Shape validated server-side.
  @IsOptional() @IsObject() reviewFramework?: Record<string, unknown>;
  // The Cardano Vision 2030 question set (same shape), reference digest, and source URL.
  @IsOptional() @IsObject() visionFramework?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(60_000) visionReference?: string;
  @IsOptional() @IsString() @MaxLength(2000) visionSourceUrl?: string;
  // How often (hours) the platform checks for a new Treasury Withdrawal to auto-score.
  @IsOptional() @IsInt() @Min(1) @Max(720) checkIntervalHours?: number;
  // Whether the automatic review (background auto-scoring of new Treasury Withdrawals) is on.
  @IsOptional() @IsBoolean() autoCheckEnabled?: boolean;
}

export class UpdatePublicScanDto {
  // Master switch for the public pay-to-scan tool.
  @IsOptional() @IsBoolean() enabled?: boolean;
  // Fee in whole ADA a user pays per scan (default 300).
  @IsOptional() @IsInt() @Min(1) @Max(100000) feeAda?: number;
  // Receiving address override (empty = network default: mainnet fixed / preprod active board multisig).
  @IsOptional() @IsString() @MaxLength(200) address?: string;
}

export class CreatePublicScanDto {
  @IsString() @MinLength(10) @MaxLength(140) walletStakeAddr!: string;
  @IsOptional() @IsString() @MaxLength(140) walletPaymentAddr?: string;
  @IsString() @MaxLength(400) title!: string;
  @IsOptional() @IsString() @MaxLength(20_000) abstract?: string;
  @IsOptional() @IsString() @MaxLength(60_000) motivation?: string;
  @IsOptional() @IsString() @MaxLength(60_000) rationale?: string;
  // Requested treasury amount in ADA (optional — only withdrawal proposals).
  @IsOptional() @IsNumber() @Min(0) @Max(45_000_000_000) amountAda?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(2000, { each: true }) extraLinks?: string[];
}

export class EditPublicScanDto {
  @IsString() @MaxLength(400) title!: string;
  @IsOptional() @IsString() @MaxLength(20_000) abstract?: string;
  @IsOptional() @IsString() @MaxLength(60_000) motivation?: string;
  @IsOptional() @IsString() @MaxLength(60_000) rationale?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(45_000_000_000) amountAda?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(2000, { each: true }) extraLinks?: string[];
}

export class PublicScanTxDto {
  @IsString() @MinLength(64) @MaxLength(80) txHash!: string;
}

export class TemplateTiersDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(45_000_000_000) smallMax?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(45_000_000_000) middleMax?: number;
  // { small?, middle?, large? } — shape merged + sanitised server-side.
  @IsOptional() @IsObject() names?: { small?: string; middle?: string; large?: string };
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(1000, { each: true }) middleQuestions?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(1000, { each: true }) largeQuestions?: string[];
}
export class GenerateTierDto {
  @IsString() tier!: string; // 'middle' | 'large' — validated in the service
  @IsOptional() @IsInt() @Min(1) @Max(10) count?: number;
}

export class MyScansDto {
  @IsString() @MinLength(10) @MaxLength(140) stakeAddress!: string;
  @IsString() @MaxLength(4000) signature!: string;
  @IsString() @MaxLength(4000) key!: string;
}

export class CreateRuleDocDto {
  @IsString() @MaxLength(80) ruleDocId!: string;
  @IsOptional() @IsString() @MaxLength(300) title?: string;
}

export class ScoreDto {
  @IsString() @MaxLength(80) templateId!: string;
  @IsString() @MaxLength(120) govActionId!: string;
  // Optional external documents (GitHub repos, project site, linked specs) to read alongside the proposal.
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(2000, { each: true }) extraLinks?: string[];
}

export class SetActiveDto {
  @IsBoolean() active!: boolean;
}

export class GovActionTitlesDto {
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @MaxLength(120, { each: true }) ids!: string[];
}
