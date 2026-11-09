import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardGuard } from '../auth/board.guard';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

// PrismaService comes from the global PrismaModule; AuthModule provides the guards (BoardService).
@Module({
  imports: [AuthModule],
  controllers: [EventsController],
  providers: [EventsService, BoardGuard],
})
export class EventsModule {}
