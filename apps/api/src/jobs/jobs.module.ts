import { Module } from '@nestjs/common';
import { CardanoModule } from '../cardano/cardano.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RequestsModule } from '../requests/requests.module';
import { GroupsModule } from '../groups/groups.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [CardanoModule, TreasuryModule, NotificationsModule, RequestsModule, GroupsModule],
  providers: [JobsService],
})
export class JobsModule {}
