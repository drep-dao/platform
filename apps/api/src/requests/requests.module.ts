import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CardanoModule } from '../cardano/cardano.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

/** §R — submitter Requests (DRep DAO edition): queue, fee flow, board price list. */
@Module({
  imports: [AuthModule, CardanoModule, TreasuryModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
