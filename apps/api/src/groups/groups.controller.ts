import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser, type AuthContext } from '../auth/current-user.decorator';
import { GroupsService } from './groups.service';
import { GroupCommentDto, GroupVoteDto, RegisterGroupDto, SubmitGroupProposalDto } from './dto';

/** §29 — configurable groups (e.g. OG): membership, member-submitted proposals + voting, comments. */
@Controller('groups')
export class GroupsController {
  constructor(private readonly svc: GroupsService) {}

  // Active groups drive the dynamic left-nav + the "Register as X member" entries.
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  list() {
    return this.svc.listActive();
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() ctx: AuthContext) {
    return this.svc.myMemberships(ctx.userId);
  }

  // ── proposals (by id — declared before /:key to keep 'proposal' unambiguous) ──
  @Get('proposal/:id')
  @UseGuards(OptionalJwtAuthGuard)
  proposal(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() ctx?: AuthContext) {
    return this.svc.getProposal(ctx?.userId ?? null, id);
  }

  @Post('proposal/:id/vote')
  @UseGuards(JwtAuthGuard)
  vote(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GroupVoteDto) {
    return this.svc.vote(ctx.userId, id, dto);
  }

  @Post('proposal/:id/comments')
  @UseGuards(JwtAuthGuard)
  comment(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GroupCommentDto) {
    return this.svc.addComment(ctx.userId, id, dto);
  }

  @Delete('comment/:id')
  @UseGuards(JwtAuthGuard)
  deleteComment(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteComment(ctx.userId, id);
  }

  // ── per-group (by key) ───────────────────────────────────────────────────────
  @Get(':key/membership')
  @UseGuards(JwtAuthGuard)
  membership(@CurrentUser() ctx: AuthContext, @Param('key') key: string) {
    return this.svc.myMembership(ctx.userId, key);
  }

  @Post(':key/register')
  @UseGuards(JwtAuthGuard)
  register(@CurrentUser() ctx: AuthContext, @Param('key') key: string, @Body() dto: RegisterGroupDto) {
    return this.svc.register(ctx.userId, key, dto);
  }

  @Get(':key/members')
  @UseGuards(OptionalJwtAuthGuard)
  members(@Param('key') key: string, @CurrentUser() ctx?: AuthContext) {
    return this.svc.listMembers(ctx?.userId ?? null, key);
  }

  @Post(':key/members/:memberId/approve')
  @UseGuards(JwtAuthGuard)
  approve(@CurrentUser() ctx: AuthContext, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.svc.setMemberStatus(ctx.userId, memberId, 'approve');
  }

  @Post(':key/members/:memberId/reject')
  @UseGuards(JwtAuthGuard)
  reject(@CurrentUser() ctx: AuthContext, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.svc.setMemberStatus(ctx.userId, memberId, 'reject');
  }

  @Post(':key/members/:memberId/kick')
  @UseGuards(JwtAuthGuard)
  kick(@CurrentUser() ctx: AuthContext, @Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.svc.setMemberStatus(ctx.userId, memberId, 'kick');
  }

  @Get(':key/proposals')
  @UseGuards(OptionalJwtAuthGuard)
  proposals(@Param('key') key: string, @CurrentUser() ctx?: AuthContext) {
    return this.svc.listProposals(ctx?.userId ?? null, key);
  }

  @Post(':key/proposals')
  @UseGuards(JwtAuthGuard)
  submit(@CurrentUser() ctx: AuthContext, @Param('key') key: string, @Body() dto: SubmitGroupProposalDto) {
    return this.svc.submitProposal(ctx.userId, key, dto);
  }
}
