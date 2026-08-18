import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { RequestsService } from './requests.service';
import { CreateRequestDto, CreateRequestTypeDto, SetRequestStatusDto, SubmitRequestFeeDto, UpdateRequestTypeDto } from './dto';

/** §R — submitter Requests: queue + history, fee flow, and the board price list. */
@Controller('requests')
@UseGuards(JwtAuthGuard)
export class RequestsController {
  constructor(private readonly svc: RequestsService) {}

  @Get('types')
  types(@Query('all') all?: string) {
    return this.svc.listTypes(all === '1');
  }

  @Get('fee-address')
  async feeAddress() {
    return { address: await this.svc.feeAddress() };
  }

  @Get()
  list(@CurrentUser() ctx: AuthContext, @Query('status') status?: string) {
    return this.svc.list(ctx.userId, status || undefined);
  }

  @Get(':id')
  get(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(id, ctx.userId);
  }

  @Post()
  submit(@CurrentUser() ctx: AuthContext, @Body() dto: CreateRequestDto) {
    return this.svc.submit(ctx.userId, dto);
  }

  @Post(':id/fee-tx')
  submitFee(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitRequestFeeDto) {
    return this.svc.submitFeeTx(ctx.userId, id, dto.txHash);
  }

  @Post(':id/recheck-fee')
  recheck(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.recheckFee(ctx.userId, id);
  }

  // board-only inside the service
  @Post(':id/status')
  setStatus(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRequestStatusDto) {
    return this.svc.setStatus(ctx.userId, id, dto.status);
  }

  @Post('types')
  createType(@CurrentUser() ctx: AuthContext, @Body() dto: CreateRequestTypeDto) {
    return this.svc.createType(ctx.userId, dto);
  }

  @Patch('types/:id')
  updateType(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRequestTypeDto) {
    return this.svc.updateType(ctx.userId, id, dto);
  }

  @Delete('types/:id')
  deleteType(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteType(ctx.userId, id);
  }
}
