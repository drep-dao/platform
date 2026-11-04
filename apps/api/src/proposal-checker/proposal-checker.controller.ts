import { Body, Controller, Delete, Get, HttpException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, type AuthContext } from '../auth/current-user.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { ProposalCheckerService } from './proposal-checker.service';
import { AiError } from './ai.service';
import { CreateLinkDto, CreatePublicScanDto, CreateRuleDocDto, CreateUploadDto, EditPublicScanDto, GenerateTierDto, GovActionTitlesDto, MyScansDto, PublicScanTxDto, ScoreDto, SetActiveDto, TemplateTiersDto, UpdateAiDto, UpdatePublicScanDto } from './dto';

/** Map a typed AI failure to an HTTP status + { code, message } the frontend can show plainly. */
function aiHttp(e: unknown): never {
  if (e instanceof AiError) {
    const status =
      e.code === 'insufficient_quota' ? 402 : e.code === 'rate_limited' ? 429 : e.code === 'timeout' ? 504 : e.code === 'no_key' ? 409 : 400;
    throw new HttpException({ code: e.code, message: e.message }, status);
  }
  throw e;
}

// Proposal checker — public read-only (anyone can browse templates, governance actions + past
// judgements); all configuration + actions (upload, AI config, JUDGE) are board-only.
@Controller('proposal-checker')
export class ProposalCheckerController {
  constructor(private readonly svc: ProposalCheckerService) {}

  // ── public reads ──────────────────────────────────────────────────────────────
  @Get('templates')
  @UseGuards(OptionalJwtAuthGuard)
  listTemplates(@Query('all') all?: string) {
    return this.svc.listTemplates(all === '1');
  }

  @Get('templates/:id')
  @UseGuards(OptionalJwtAuthGuard)
  getTemplate(@Param('id') id: string) {
    return this.svc.getTemplate(id);
  }

  @Get('templates/:id/original')
  @UseGuards(OptionalJwtAuthGuard)
  async original(@Param('id') id: string) {
    const o = await this.svc.getTemplateOriginal(id);
    if (!o) throw new HttpException({ message: 'no original file for this template' }, 404);
    return o;
  }

  @Get('gov-actions')
  @UseGuards(OptionalJwtAuthGuard)
  listGovActions(@Query('limit') limit?: string) {
    return this.svc.listGovActions(limit ? Number(limit) : 60);
  }

  @Get('framework')
  @UseGuards(OptionalJwtAuthGuard)
  framework() {
    return this.svc.reviewFramework();
  }

  @Get('vision')
  @UseGuards(OptionalJwtAuthGuard)
  vision() {
    return this.svc.visionConfig();
  }

  @Get('gov-actions/:id')
  @UseGuards(OptionalJwtAuthGuard)
  getGovAction(@Param('id') id: string) {
    return this.svc.getGovAction(id);
  }

  @Post('gov-action-titles')
  @UseGuards(JwtAuthGuard, BoardGuard)
  govActionTitles(@Body() dto: GovActionTitlesDto) {
    return this.svc.govActionTitles(dto.ids);
  }

  @Get('results')
  @UseGuards(OptionalJwtAuthGuard)
  listResults(@Query('templateId') templateId?: string) {
    return this.svc.listResults(templateId);
  }

  // ── board config + actions ─────────────────────────────────────────────────────
  @Get('ai-config')
  @UseGuards(JwtAuthGuard, BoardGuard)
  aiConfig() {
    return this.svc.getAiConfig();
  }

  @Patch('ai-config')
  @UseGuards(JwtAuthGuard, BoardGuard)
  async updateAiConfig(@CurrentUser() ctx: AuthContext, @Body() dto: UpdateAiDto) {
    try {
      return await this.svc.updateAiConfig(dto, ctx.userId);
    } catch (e) {
      aiHttp(e); // a missing required placeholder in the prompt comes back as a clear 400
    }
  }

  @Post('ai-config/test')
  @UseGuards(JwtAuthGuard, BoardGuard)
  async testAi() {
    try {
      return await this.svc.testAi();
    } catch (e) {
      aiHttp(e);
    }
  }

  @Get('public-scan-config')
  @UseGuards(JwtAuthGuard, BoardGuard)
  publicScanConfig() {
    return this.svc.publicScanConfig();
  }

  @Patch('public-scan-config')
  @UseGuards(JwtAuthGuard, BoardGuard)
  updatePublicScanConfig(@CurrentUser() ctx: AuthContext, @Body() dto: UpdatePublicScanDto) {
    return this.svc.setPublicScanConfig(dto, ctx.userId);
  }

  // ── ask-size tiers (extra template requirements for larger withdrawals) ─────────
  @Get('template-tiers')
  @UseGuards(JwtAuthGuard, BoardGuard)
  templateTiers() {
    return this.svc.templateTiersConfig();
  }

  @Patch('template-tiers')
  @UseGuards(JwtAuthGuard, BoardGuard)
  updateTemplateTiers(@CurrentUser() ctx: AuthContext, @Body() dto: TemplateTiersDto) {
    return this.svc.setTemplateTiersConfig(dto, ctx.userId);
  }

  @Post('template-tiers/generate')
  @UseGuards(JwtAuthGuard, BoardGuard)
  async generateTierQuestions(@Body() dto: GenerateTierDto) {
    const tier = dto.tier === 'large' ? 'large' : 'middle';
    try {
      return { questions: await this.svc.generateTierQuestions(tier, dto.count ?? 3) };
    } catch (e) {
      aiHttp(e);
    }
  }

  // ── public pay-to-scan (no auth; a wallet pays a fee, then runs the engine on a draft) ──────────
  @Get('scan-tool')
  scanTool() {
    return this.svc.publicScanPublicConfig();
  }

  @Get('scan-sign-message')
  scanSignMessage(@Query('stake') stake: string) {
    return { message: this.svc.scanOwnershipMessage(stake || '') };
  }

  @Post('scan')
  @RateLimit({ points: 20, durationSec: 60, by: 'ip' })
  createScan(@Body() dto: CreatePublicScanDto) {
    return this.svc.createPublicScan(dto);
  }

  // Declared before 'scan/:id' so "mine" is not captured as an id.
  @Post('scan/mine')
  @RateLimit({ points: 30, durationSec: 60, by: 'ip' })
  myScans(@Body() dto: MyScansDto) {
    return this.svc.listMyPublicScans(dto.stakeAddress, dto.signature, dto.key);
  }

  @Get('scan/:id')
  getScan(@Param('id') id: string) {
    return this.svc.publicScanView(id);
  }

  // Edit the draft proposal text while the scan is still unspent (not DONE) — e.g. after paying but
  // before pressing SCAN. Unauthenticated like the rest of this flow (guarded by the unguessable id).
  @Patch('scan/:id')
  @RateLimit({ points: 30, durationSec: 60, by: 'ip' })
  editScan(@Param('id') id: string, @Body() dto: EditPublicScanDto) {
    return this.svc.editPublicScanDraft(id, dto);
  }

  @Post('scan/:id/tx')
  @RateLimit({ points: 20, durationSec: 60, by: 'ip' })
  attachScanTx(@Param('id') id: string, @Body() dto: PublicScanTxDto) {
    return this.svc.attachPublicScanTx(id, dto.txHash);
  }

  @Post('scan/:id/verify')
  @RateLimit({ points: 30, durationSec: 60, by: 'ip' })
  verifyScan(@Param('id') id: string) {
    return this.svc.recheckPublicScan(id);
  }

  @Post('scan/:id/run')
  @RateLimit({ points: 10, durationSec: 60, by: 'ip' })
  runScan(@Param('id') id: string) {
    return this.svc.runPublicScan(id);
  }

  // Edit and Rescan: fork a scan into a new editable version (keeps the original, links to it).
  @Post('scan/:id/fork')
  @RateLimit({ points: 20, durationSec: 60, by: 'ip' })
  forkScan(@Param('id') id: string) {
    return this.svc.forkPublicScan(id);
  }

  // ── board/admin view of the public scans ──────────────────────────────────────
  @Get('scans')
  @UseGuards(JwtAuthGuard, BoardGuard)
  listScans() {
    return this.svc.listPublicScans();
  }

  @Get('scans/:id')
  @UseGuards(JwtAuthGuard, BoardGuard)
  scanDetail(@Param('id') id: string) {
    return this.svc.publicScanBoardDetail(id);
  }

  @Post('templates/upload')
  @UseGuards(JwtAuthGuard, BoardGuard)
  upload(@CurrentUser() ctx: AuthContext, @Body() dto: CreateUploadDto) {
    return this.svc.createFromUpload({ title: dto.title ?? '', dataUrl: dto.dataUrl, fileName: dto.fileName }, ctx.userId);
  }

  @Post('templates/link')
  @UseGuards(JwtAuthGuard, BoardGuard)
  link(@CurrentUser() ctx: AuthContext, @Body() dto: CreateLinkDto) {
    return this.svc.createFromLink({ title: dto.title, url: dto.url }, ctx.userId);
  }

  @Post('templates/rule-doc')
  @UseGuards(JwtAuthGuard, BoardGuard)
  ruleDoc(@CurrentUser() ctx: AuthContext, @Body() dto: CreateRuleDocDto) {
    return this.svc.createFromRuleDoc(dto.ruleDocId, dto.title, ctx.userId);
  }

  @Patch('templates/:id/active')
  @UseGuards(JwtAuthGuard, BoardGuard)
  setActive(@Param('id') id: string, @Body() dto: SetActiveDto) {
    return this.svc.setTemplateActive(id, dto.active);
  }

  @Delete('templates/:id')
  @UseGuards(JwtAuthGuard, BoardGuard)
  remove(@Param('id') id: string) {
    return this.svc.deleteTemplate(id);
  }

  @Post('score')
  @UseGuards(JwtAuthGuard, BoardGuard)
  async score(@CurrentUser() ctx: AuthContext, @Body() dto: ScoreDto) {
    try {
      return await this.svc.score(dto.templateId, dto.govActionId, ctx.userId, dto.extraLinks);
    } catch (e) {
      aiHttp(e);
    }
  }

  @Get('results/:id/log')
  @UseGuards(JwtAuthGuard, BoardGuard)
  resultLog(@Param('id') id: string) {
    return this.svc.getResultLog(id);
  }

  @Delete('results/:id')
  @UseGuards(JwtAuthGuard, BoardGuard)
  deleteResult(@Param('id') id: string) {
    return this.svc.deleteResult(id);
  }

  @Post('check-now')
  @UseGuards(JwtAuthGuard, BoardGuard)
  async checkNow(@CurrentUser() ctx: AuthContext) {
    try {
      return await this.svc.runCheck({ force: true, userId: ctx.userId });
    } catch (e) {
      aiHttp(e);
    }
  }
}
