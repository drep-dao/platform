import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { RequestsService } from './requests.service';
import { CreateRequestDto, CreateRequestTypeDto, PublishRequestDto, RequestCommentBodyDto, SaveFormConfigDto, SetLinkedProposalDto, SetRequestResultDto, SetRequestStatusDto, SubmitRequestFeeDto, UpdateRequestDto, UpdateRequestTypeDto } from './dto';

/** §R — submitter Requests: queue + history, fee flow, and the board price list. */
@Controller('requests')
export class RequestsController {
  constructor(private readonly svc: RequestsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('types')
  types(@Query('all') all?: string) {
    return this.svc.listTypes(all === '1');
  }

  @UseGuards(JwtAuthGuard)
  @Get('fee-address')
  async feeAddress() {
    return { address: await this.svc.feeAddress() };
  }

  // §R2 — the configured form (elements per kind) submitters render. Any authenticated user reads it.
  @UseGuards(JwtAuthGuard)
  @Get('form-config')
  formConfig() {
    return this.svc.getFormConfig();
  }

  // §R2 — board saves the element list for one kind. board-only inside the service.
  @UseGuards(JwtAuthGuard)
  @Post('form-config')
  saveFormConfig(@CurrentUser() ctx: AuthContext, @Body() dto: SaveFormConfigDto) {
    return this.svc.saveFormConfig(ctx.userId, dto.kind, dto.elements);
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  list(@Query('status') status?: string, @CurrentUser() ctx?: AuthContext) {
    return this.svc.list(ctx?.userId ?? null, status || undefined);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() ctx?: AuthContext) {
    return this.svc.get(id, ctx?.userId ?? null);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  submit(@CurrentUser() ctx: AuthContext, @Body() dto: CreateRequestDto) {
    return this.svc.submit(ctx.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRequestDto) {
    return this.svc.update(ctx.userId, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/publish')
  publish(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PublishRequestDto) {
    return this.svc.publish(ctx.userId, id, dto.feeTxHash ?? null);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ctx.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/comments')
  comment(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequestCommentBodyDto) {
    return this.svc.addComment(ctx.userId, id, { contentMd: dto.contentMd, parentId: dto.parentId });
  }

  @UseGuards(JwtAuthGuard)
  @Delete('comments/:id')
  deleteComment(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteComment(ctx.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/fee-tx')
  submitFee(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitRequestFeeDto) {
    return this.svc.submitFeeTx(ctx.userId, id, dto.txHash);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/recheck-fee')
  recheck(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.recheckFee(ctx.userId, id);
  }

  // board-only inside the service
  @UseGuards(JwtAuthGuard)
  @Post(':id/status')
  setStatus(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRequestStatusDto) {
    return this.svc.setStatus(ctx.userId, id, dto.status);
  }

  // board-only inside the service — attach/edit the request's result (markdown); empty clears it
  @UseGuards(JwtAuthGuard)
  @Post(':id/result')
  setResult(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRequestResultDto) {
    return this.svc.setResult(ctx.userId, id, dto.result ?? '');
  }

  // board-only inside the service — link/unlink an internal proposal (escalate to a vote)
  @UseGuards(JwtAuthGuard)
  @Post(':id/linked-proposal')
  setLinkedProposal(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetLinkedProposalDto) {
    return this.svc.setLinkedProposal(ctx.userId, id, dto.proposalId ?? null);
  }

  @UseGuards(JwtAuthGuard)
  @Post('types')
  createType(@CurrentUser() ctx: AuthContext, @Body() dto: CreateRequestTypeDto) {
    return this.svc.createType(ctx.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('types/:id')
  updateType(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRequestTypeDto) {
    return this.svc.updateType(ctx.userId, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('types/:id')
  deleteType(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteType(ctx.userId, id);
  }
}
