import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { InternalProposalsService } from './internal-proposals.service';
import { CreateInternalProposalDto, SaveDraftDto, VoteInternalDto } from './dto';

// §10 — internal proposals (threshold voting / polls). Reading the PUBLIC ones is open to everyone
// (anyone can watch + share a proposal link); PRIVATE/DRAFT ones are filtered in the service, and all
// writes (submit, vote, drafts, finalize) require a signed-in wallet.
@Controller('internal-proposals')
export class InternalProposalsController {
  constructor(private readonly internal: InternalProposalsService) {}

  // Public read — logged-out viewers see the public proposals (PRIVATE/DRAFT filtered out in the service).
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  list(@CurrentUser() c?: AuthContext) {
    return this.internal.list(c?.userId ?? null);
  }

  // Static route must come BEFORE @Get(':id') (UUID pipe would reject 'pending-count').
  @Get('pending-count')
  @UseGuards(JwtAuthGuard)
  pendingCount(@CurrentUser() c: AuthContext) {
    return this.internal.pendingCount(c.userId);
  }

  // §10 — drafts: author-only work-in-progress (status DRAFT, no voting). Create / update / delete.
  @Post('drafts')
  @UseGuards(JwtAuthGuard)
  saveDraft(@CurrentUser() c: AuthContext, @Body() dto: SaveDraftDto) {
    return this.internal.saveDraft(c.userId, dto);
  }

  @Patch('drafts/:id')
  @UseGuards(JwtAuthGuard)
  updateDraft(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveDraftDto) {
    return this.internal.updateDraft(c.userId, id, dto);
  }

  @Delete('drafts/:id')
  @UseGuards(JwtAuthGuard)
  deleteDraft(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.internal.deleteDraft(c.userId, id);
  }

  // Public read — a shared proposal link opens for anyone (PRIVATE ones still 403 for non-board/non-author).
  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() c?: AuthContext) {
    return this.internal.detail(id, c?.userId ?? null);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  submit(@CurrentUser() c: AuthContext, @Body() dto: CreateInternalProposalDto) {
    return this.internal.submit(c.userId, dto);
  }

  @Post(':id/vote')
  @UseGuards(JwtAuthGuard)
  vote(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoteInternalDto) {
    return this.internal.vote(c.userId, id, dto);
  }

  @Post(':id/finalize')
  @UseGuards(JwtAuthGuard)
  finalize(@Param('id', ParseUUIDPipe) id: string) {
    return this.internal.finalize(id);
  }

  // §14 — board member triggers the new-board installation early (after the election is APPROVED).
  @Post(':id/install-board')
  @UseGuards(JwtAuthGuard)
  installBoard(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.internal.installNewBoard(c.userId, id);
  }
}
