import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { InternalProposalsService } from './internal-proposals.service';
import { CreateInternalProposalDto, SaveDraftDto, VoteInternalDto, SaveDocumentDto, AddAttachmentDto, RenameAttachmentDto, OpenVotingDto, ProbeLinkDto } from './dto';

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

  // §10 — board member soft-deletes a submitted proposal (kept as DELETED for the record). The
  // service enforces the board-only check. Route is one segment, so it never collides with drafts/:id.
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.internal.deleteProposal(c.userId, id);
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

  // §10 — push out the voting deadline (election: submitter only; otherwise board only; must be enabled).
  @Post(':id/extend')
  @UseGuards(JwtAuthGuard)
  extend(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: { votingEndAt: string }) {
    return this.internal.extend(c.userId, id, dto.votingEndAt);
  }

  // §30 — "Document for public comment": create (→ status COMMENT), edit while in comment phase,
  // manage attachments (files/links), download an uploaded file, and open voting (author/board).
  @Post('document')
  @UseGuards(JwtAuthGuard)
  createDocument(@CurrentUser() c: AuthContext, @Body() dto: SaveDocumentDto) {
    return this.internal.saveForComment(c.userId, dto);
  }

  @Patch('document/:id')
  @UseGuards(JwtAuthGuard)
  updateDocument(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveDocumentDto) {
    return this.internal.updateDocument(c.userId, id, dto);
  }

  // §30 — probe a link while composing (can we fetch + read it?), so the author gets a readability check.
  @Post('probe-link')
  @UseGuards(JwtAuthGuard)
  probeLink(@Body() dto: ProbeLinkDto) {
    return this.internal.probeLink(dto.url);
  }

  // §30 — pull a link's full text so the author can insert it as the document body while composing.
  @Post('fetch-link')
  @UseGuards(JwtAuthGuard)
  fetchLink(@Body() dto: ProbeLinkDto) {
    return this.internal.fetchLinkText(dto.url);
  }

  @Post(':id/attachments')
  @UseGuards(JwtAuthGuard)
  addAttachment(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddAttachmentDto) {
    return this.internal.addAttachment(c.userId, id, dto);
  }

  @Delete(':id/attachments/:attId')
  @UseGuards(JwtAuthGuard)
  removeAttachment(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('attId', ParseUUIDPipe) attId: string) {
    return this.internal.removeAttachment(c.userId, id, attId);
  }

  // §30 — name (or rename) an already-added file/link; works retroactively while open for comment.
  @Patch(':id/attachments/:attId')
  @UseGuards(JwtAuthGuard)
  renameAttachment(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('attId', ParseUUIDPipe) attId: string, @Body() dto: RenameAttachmentDto) {
    return this.internal.renameAttachment(c.userId, id, attId, dto.title);
  }

  // Public read of an uploaded file (the service enforces the private-document gate).
  @Get(':id/attachments/:attId/file')
  @UseGuards(OptionalJwtAuthGuard)
  attachmentFile(@Param('id', ParseUUIDPipe) id: string, @Param('attId', ParseUUIDPipe) attId: string, @CurrentUser() c?: AuthContext) {
    return this.internal.getAttachmentFile(id, attId, c?.userId ?? null);
  }

  @Post(':id/open-voting')
  @UseGuards(JwtAuthGuard)
  openVoting(@CurrentUser() c: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OpenVotingDto) {
    return this.internal.openVoting(c.userId, id, dto);
  }
}
