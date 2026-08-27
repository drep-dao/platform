import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser, type AuthContext } from '../auth/current-user.decorator';
import { GroupsService } from './groups.service';
import { GroupCommentDto, GroupVoteDto, GroupVotingSettingsDto, RegisterGroupDto, SubmitGroupProposalDto } from './dto';

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

  // §29 — count of pending applicants across groups this member may approve (for the to-do badge).
  @Get('pending-approvals-count')
  @UseGuards(JwtAuthGuard)
  async pendingApprovalsCount(@CurrentUser() ctx: AuthContext) {
    return { count: await this.svc.pendingApprovalsCount(ctx.userId) };
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

  @Patch(':key/profile')
  @UseGuards(JwtAuthGuard)
  updateProfile(@CurrentUser() ctx: AuthContext, @Param('key') key: string, @Body() dto: RegisterGroupDto) {
    return this.svc.updateProfile(ctx.userId, key, dto);
  }

  // §29 OG — leave the group.
  @Post(':key/leave')
  @UseGuards(JwtAuthGuard)
  leave(@CurrentUser() ctx: AuthContext, @Param('key') key: string) {
    return this.svc.leaveGroup(ctx.userId, key);
  }

  // §29 OG — set the group's voting quorum (self-governed; any admitted member).
  @Patch(':key/voting')
  @UseGuards(JwtAuthGuard)
  updateVoting(@CurrentUser() ctx: AuthContext, @Param('key') key: string, @Body() dto: GroupVotingSettingsDto) {
    return this.svc.updateVotingSettings(ctx.userId, key, dto);
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
