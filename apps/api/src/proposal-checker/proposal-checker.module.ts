import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { ProposalCheckerController } from './proposal-checker.controller';
import { ProposalCheckerService } from './proposal-checker.service';
import { ProposalScoreJobService } from './proposal-score-job.service';
import { AiService } from './ai.service';

// CardanoQueryService + PrismaService come from global modules; AuthModule provides the guards.
@Module({
  imports: [AuthModule],
  controllers: [ProposalCheckerController],
  providers: [ProposalCheckerService, AiService, BoardGuard, ProposalScoreJobService],
})
export class ProposalCheckerModule {}
