import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { CurrentAdmin } from './current-admin.decorator';
import type { AdminIdentity } from './admin-auth.service';
import { AdminAuditService } from './admin-audit.service';
import { GroupsService } from '../groups/groups.service';
import { AdminCreateGroupDto, AdminUpdateGroupDto } from '../groups/dto';

/**
 * §29 — sysadmin GROUPS tab. Only a sysadmin can create/configure/activate a configurable group
 * (e.g. OG). A group is HIDDEN on creation; setting status ACTIVE turns it on for the platform.
 */
@Controller('sysadmin/groups')
@UseGuards(AdminGuard)
export class SysadminGroupsController {
  constructor(
    private readonly svc: GroupsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  list() {
    return this.svc.adminList();
  }

  @Get('dreps')
  dreps() {
    return this.svc.adminDrepOptions();
  }

  @Post()
  async create(@CurrentAdmin() admin: AdminIdentity, @Body() dto: AdminCreateGroupDto) {
    const r = await this.svc.adminCreate(dto);
    await this.audit.log({ adminId: admin.adminId, action: 'group.create', target: dto.key, payload: { name: dto.name } });
    return r;
  }

  @Patch(':id')
  async update(@CurrentAdmin() admin: AdminIdentity, @Param('id') id: string, @Body() dto: AdminUpdateGroupDto) {
    const r = await this.svc.adminUpdate(id, dto);
    await this.audit.log({ adminId: admin.adminId, action: 'group.update', target: id, payload: JSON.parse(JSON.stringify(dto)) });
    return r;
  }

  @Get(':id/members')
  members(@Param('id') id: string) {
    return this.svc.adminMembers(id);
  }

  @Post(':id/members/:memberId/approve')
  async approveMember(@CurrentAdmin() admin: AdminIdentity, @Param('memberId') memberId: string) {
    const r = await this.svc.adminSetMemberStatus(memberId, 'approve');
    await this.audit.log({ adminId: admin.adminId, action: 'group.member.approve', target: memberId });
    return r;
  }

  @Post(':id/members/:memberId/kick')
  async kickMember(@CurrentAdmin() admin: AdminIdentity, @Param('memberId') memberId: string) {
    const r = await this.svc.adminSetMemberStatus(memberId, 'kick');
    await this.audit.log({ adminId: admin.adminId, action: 'group.member.kick', target: memberId });
    return r;
  }
}
