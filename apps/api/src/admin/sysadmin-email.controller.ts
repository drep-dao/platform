import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AdminGuard } from './admin.guard';
import { CurrentAdmin } from './current-admin.decorator';
import type { AdminIdentity } from './admin-auth.service';
import { AdminAuditService } from './admin-audit.service';
import { EmailService } from '../notifications/email.service';

class EmailConfigDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(200) host?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsBoolean() secure?: boolean;
  @IsOptional() @IsString() @MaxLength(200) user?: string;
  @IsOptional() @IsString() @MaxLength(200) from?: string;
  @IsOptional() @IsString() @MaxLength(400) password?: string; // non-empty replaces the stored secret; '' keeps it
}

class TestEmailDto {
  @IsEmail() to!: string;
}

/**
 * §20.3 — platform-admin configuration of OUTBOUND email (SMTP relay). The platform only sends mail; it
 * never receives it. The sysadmin can set this even before a board is elected. Password is stored
 * encrypted (never returned); every change is audited.
 */
@Controller('sysadmin/email')
@UseGuards(AdminGuard)
export class SysadminEmailController {
  constructor(
    private readonly email: EmailService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  status() {
    return this.email.adminStatus();
  }

  @Patch()
  async save(@CurrentAdmin() admin: AdminIdentity, @Body() dto: EmailConfigDto) {
    const r = await this.email.saveConfig(dto);
    await this.audit.log({ adminId: admin.adminId, action: 'email.config', payload: { enabled: r.enabled, host: r.host, from: r.from } });
    return r;
  }

  @Post('test')
  async test(@CurrentAdmin() admin: AdminIdentity, @Body() dto: TestEmailDto) {
    const r = await this.email.sendTest(dto.to);
    await this.audit.log({ adminId: admin.adminId, action: 'email.test', target: dto.to });
    return r;
  }
}
