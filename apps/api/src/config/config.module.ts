import { Module } from '@nestjs/common';
import { PublicConfigController } from './public-config.controller';
import { PublicOverviewController } from './public-overview.controller';
import { RoundsModule } from '../rounds/rounds.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { InternalProposalsModule } from '../internal-proposals/internal-proposals.module';
import { GroupsModule } from '../groups/groups.module';

@Module({
  imports: [RoundsModule, TreasuryModule, InternalProposalsModule, GroupsModule],
  controllers: [PublicConfigController, PublicOverviewController],
})
export class PublicConfigModule {}
