import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { DrepService } from './drep.service';
import { AdmissionVoteDto } from './dto';

// §14.1 — board Setup tester: check whether a given DRep would pass the current entry gates.
export class EntryTestDto {
  @IsString() @MaxLength(200) drepId!: string;
  @IsOptional() @IsString() @MaxLength(200) stakeAddress?: string;
}

// §25.5 — board-only review of DRep applications.
@Controller('admin/drep-applications')
@UseGuards(JwtAuthGuard, BoardGuard)
export class BoardAdmissionController {
  constructor(private readonly drep: DrepService) {}

  @Get()
  list(@CurrentUser() ctx: AuthContext, @Query('history') history?: string) {
    return this.drep.listApplications(ctx.userId, history === '1');
  }

  @Post(':drepId/vote')
  vote(
    @CurrentUser() ctx: AuthContext,
    @Param('drepId', ParseUUIDPipe) drepId: string,
    @Body() dto: AdmissionVoteDto,
  ) {
    return this.drep.voteOnApplication(ctx.userId, drepId, dto);
  }

  // §14.1 — Setup tester: would this DRep pass the (currently-saved) on-chain entry gates?
  @Post('entry-test')
  entryTest(@Body() dto: EntryTestDto) {
    return this.drep.verifyEntryForDrep(dto.drepId, dto.stakeAddress);
  }
}
