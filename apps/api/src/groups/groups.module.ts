import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';

// §29 — configurable groups. Exports GroupsService so the sysadmin GROUPS controller
// (in AdminModule) can drive create/configure/activate.
@Module({
  imports: [AuthModule],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
