import { Module } from '@nestjs/common';
import { PublicConfigController } from './public-config.controller';
import { PublicOverviewController } from './public-overview.controller';
import { RoundsModule } from '../rounds/rounds.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { InternalProposalsModule } from '../internal-proposals/internal-proposals.module';

@Module({
  imports: [RoundsModule, TreasuryModule, InternalProposalsModule],
  controllers: [PublicConfigController, PublicOverviewController],
})
export class PublicConfigModule {}
