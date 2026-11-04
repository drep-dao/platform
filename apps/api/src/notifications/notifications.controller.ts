import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, type AuthContext } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

class NotificationPrefsDto {
  @IsOptional() @IsBoolean() email?: boolean;
  @IsOptional() @IsString() @MaxLength(320) emailAddr?: string | null;
}

@Controller('me/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() ctx: AuthContext) {
    return this.svc.listMine(ctx.userId);
  }

  // §20.3 — the user's email-notification toggle (default on) + where emails would go.
  @Get('preferences')
  prefs(@CurrentUser() ctx: AuthContext) {
    return this.svc.getPreferences(ctx.userId);
  }

  @Patch('preferences')
  setPrefs(@CurrentUser() ctx: AuthContext, @Body() dto: NotificationPrefsDto) {
    return this.svc.setPreferences(ctx.userId, dto);
  }

  @Get('unread-count')
  async unread(@CurrentUser() ctx: AuthContext) {
    return { count: await this.svc.unreadCount(ctx.userId) };
  }

  @Post(':id/read')
  read(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markRead(ctx.userId, id);
  }

  @Post('read-all')
  readAll(@CurrentUser() ctx: AuthContext) {
    return this.svc.markAllRead(ctx.userId);
  }
}
